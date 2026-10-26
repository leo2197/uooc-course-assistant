const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const decoded = decodeURIComponent(url);
        return new URL(decoded.split('?')[0]).pathname;
    } catch {
        return decodeURIComponent(url);
    }
}

function getVideoSrc(page) {
    return page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? (v.currentSrc || v.src || null) : null;
    });
}

class VideoTracker {
    constructor(courseId, log) {
        this.courseId = courseId;
        this.log = log;
        this.watched = new Set();
        // Legacy records used a 98.5% threshold and cannot prove playback ended.
        this.logFile = path.join(DATA_DIR, `${courseId}.ended.txt`);
        const logFile = this.logFile;
        if (fs.existsSync(logFile)) {
            const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
            lines.forEach(l => this.watched.add(l.trim()));
            log(`📖 已加载观看记录，共 ${this.watched.size} 条`);
        } else {
            log('🆕 无历史记录');
        }
    }

    isWatched(src) {
        return this.watched.has(normalizeUrl(src));
    }

    async markCurrentWatched(page) {
        const ended = await page.evaluate(() => document.querySelector('video')?.ended === true);
        if (!ended) throw Error('播放器尚未真正结束，拒绝记录完成');
        const src = await getVideoSrc(page);
        if (!src) return;
        const normalized = normalizeUrl(src);
        this.watched.add(normalized);
        fs.appendFileSync(this.logFile, normalized + '\n', 'utf-8');
        this.log('✅ 记录已刷视频');
    }

    async findUnwatchedVideo(page) {
        await page.waitForTimeout(3000);

        const iconCount = await page.evaluate(() => {
            const active = Array.from(document.querySelectorAll('.oneline.active')).at(-1);
            if (!active) return 0;
            const li = active.closest('li');
            if (!li) return 0;
            const icons = li.querySelectorAll('.icon-video');
            return icons ? icons.length : 0;
        });

        if (iconCount === 0) return false;
        this.log(`   🔎 ${iconCount} 个视频图标，逐个检查...`);

        for (let i = 0; i < iconCount; i++) {
            const taskComplete = await page.evaluate((index) => {
                const active = Array.from(document.querySelectorAll('.oneline.active')).at(-1);
                if (!active) return;
                const li = active.closest('li');
                const icons = li.querySelectorAll('.icon-video');
                if (icons?.[index]) {
                    const icon = icons[index];
                    const completed = icon.closest('.basic')?.classList.contains('complete') === true;
                    if (completed) return true;
                    try { icon.scrollIntoView({ block: 'center' }); } catch {}
                    (icon.closest('.basic') || icon).click();
                    return completed;
                }
            }, i);

            if (taskComplete === true) {
                this.log(`   ⏭️ 第 ${i + 1} 个视频平台已打勾，跳过`);
                continue;
            }
            if (taskComplete !== false) continue;

            try {
                await page.locator('video').first().waitFor({ state: 'visible', timeout: 5000 });
            } catch { continue; }

            await page.waitForTimeout(3000);
            const src = await getVideoSrc(page);
            if (src) {
                if (taskComplete === false && this.isWatched(src)) {
                    this.log('   ↻ 同一视频文件对应的当前任务尚未完成，重新完整播放');
                    await page.evaluate(() => {
                        const video = document.querySelector('video');
                        if (video?.ended) { video.currentTime = 0; video.play().catch(() => {}); }
                    });
                }
                this.log(`   ✅ 第 ${i + 1} 个视频是新的`);
                return true;
            }
        }
        return false;
    }

    async playVideo(page) {
        let quizCount = 0;
        const solvedQuizIds = new Set(); // 记录已破解的测验 ID，避免重复破解

        // ---- 卡死保护 ----
        // 原来这里是纯 while(true)，只有「视频播完」或「已看过」才会退出。
        // 视频一旦卡住（网络抖动、加载失败、duration 异常），currentTime 不再前进 → 永远出不来，
        // 表现出来就是「脚本卡住不动、日志一直刷同一行」。
        const startedAt = Date.now();
        let lastTime = -1, stalled = 0;
        let maxMs = 40 * 60 * 1000;   // 兜底上限，拿到视频时长后再按比例收紧
        let missingVideoAttempts = 0;
        let recoveryAttempts = 0;

        while (true) {
            await require('./navigation-guard').ensure(page);
            if (await page.locator('#quizLayer').isVisible().catch(() => false)) {
                // 通过 input name 属性识别当前测验
                const quizId = await page.evaluate(() => {
                    const input = document.querySelector('#quizLayer input[name]');
                    return input ? input.name : null;
                });
                if (quizId && solvedQuizIds.has(quizId)) {
                    // 已破解过的测验重新出现，跳过
                } else {
                    this.log(`📝 视频内测验 #${++quizCount}`);
                    if (!await handleVideoQuiz(page, this.log)) return false;
                    if (quizId) solvedQuizIds.add(quizId);
                }
                await page.waitForTimeout(1000);
            }

            const guard = require('./navigation-guard'), before = guard.revision(page);
            let status;
            try { status = await page.evaluate(() => {
                const v = document.querySelector('video');
                if (!v) return { ended: true, reason: 'not_found' };

                v.muted = true;
                v.loop = false;
                if (v.playbackRate !== 2.0) v.playbackRate = 2.0;

                let ended = v.ended, reason = v.ended ? 'ended' : '';

                // ended 时调用 play 会把进度重置为 0，必须先判断结束再恢复播放。
                if (!ended && v.paused) v.play().catch(() => {});

                return {
                    ended, reason,
                    currentTime: v.currentTime,
                    duration: v.duration,
                    paused: v.paused,
                    src: v.currentSrc || v.src
                };
            }); } catch (error) {
                await guard.ensure(page);
                if (guard.revision(page) !== before) continue;
                throw error;
            }

            if (status.reason === 'not_found') {
                if (++missingVideoAttempts > 2) {
                    this.log('⚠️ 视频连续缺失，停止本课程并保留未完成状态');
                    return false;
                }
                this.log('⏳ 视频暂时缺失，等待播放器重新加载...');
                try { await page.locator('video').first().waitFor({ state: 'attached', timeout: 15000 }); }
                catch { }
                await page.waitForTimeout(1000);
                continue;
            }
            missingVideoAttempts = 0;
            if (status.ended) {
                this.log(`✅ 视频结束 (${status.reason})`);
                return status.reason !== 'not_found';
            }

            const dur = isNaN(status.duration) ? '...' : status.duration.toFixed(1);
            this.log(`   ▶️ ${status.currentTime.toFixed(1)} / ${dur}`);

            // 按视频时长收紧总上限（2 倍速播放 → 实际约 duration/2 秒，这里留足余量）
            if (status.duration > 0 && isFinite(status.duration)) {
                maxMs = Math.min(maxMs, Math.max(10 * 60 * 1000, status.duration * 1000 + 5 * 60 * 1000));
            }

            // 进度长时间不动 → 判定卡住
            if (Math.abs(status.currentTime - lastTime) < 0.5) {
                stalled += 1;
            } else {
                stalled = 0;
                lastTime = status.currentTime;
            }
            if (stalled >= 40) {                       // 40 × 2.5s ≈ 100 秒没前进
                if (recoveryAttempts < 2) {
                    recoveryAttempts++;
                    this.log(`⏳ 播放器卡住，重载恢复 (${recoveryAttempts}/2)...`);
                    try {
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                        await page.waitForTimeout(3000);
                        stalled = 0; lastTime = -1;
                        continue;
                    } catch (error) {
                        this.log('⚠️ 重载失败: ' + error.message);
                        return false;
                    }
                }
                this.log('⚠️ 视频 100 秒没有前进，判定卡住 → 跳过这个视频（重跑可再试）');
                return false;
            }
            if (Date.now() - startedAt > maxMs) {
                this.log(`⚠️ 这个视频耗时超过上限（${Math.round(maxMs / 60000)} 分钟），跳过`);
                return false;
            }

            await page.waitForTimeout(2500);
        }
    }
}

async function handleVideoQuiz(page, log) {
    log('🛑 视频内出现测验，尚未核验答案，不尝试选项组合、不提交');
    try { await page.screenshot({ path: require('path').join(require('./config').DATA_DIR, 'video-quiz-pending.png') }); } catch {}
    require('./human-review').desktopNotice('视频内出现待核验测验，脚本已停下且未提交。请在Codex对话中反馈，先核对题目。');
    return false;
}

module.exports = { VideoTracker };
