const { VideoTracker } = require('./video');
const { processQuizQuestions, clickQuizTaskIfAvailable } = require('./quiz');
const { attachCollector } = require('./subtitles');

async function initSectionList(page) {
    await page.evaluate(() => {
        // 不能用 offsetParent：position:fixed/sticky 的元素它恒为 null（智慧树那边栽过这个坑）
        const items = Array.from(document.querySelectorAll('.oneline')).filter(el => el.getClientRects().length > 0);
        window.__uoocSectionList = items;
        let idx = items.findLastIndex(el => el.classList.contains('active'));
        if (idx < 0) idx = items.findLastIndex(el => el.parentElement?.matches('.basic.active'));
        if (idx < 0) idx = 0;
        window.__uoocSectionIndex = idx;
        console.log('📑 章节列表初始化，共', items.length, '节，当前 index =', idx);
    });
}

async function goToNextSection(page) {
    return page.evaluate(() => {
        // 不能用 offsetParent：position:fixed/sticky 的元素它恒为 null（智慧树那边栽过这个坑）
        const items = Array.from(document.querySelectorAll('.oneline')).filter(el => el.getClientRects().length > 0);
        let idx = items.findLastIndex(el => el.classList.contains('active'));
        if (idx < 0) idx = items.findLastIndex(el => el.parentElement?.matches('.basic.active'));
        if (idx === -1 || idx >= items.length - 1) return false;
        const next = items[idx + 1];
        try { next.scrollIntoView({ block: 'center' }); } catch {}
        next.click();
        console.log('👉 下一节：', next.innerText.trim());
        return true;
    });
}

// 往后查找最近的未完成章节/节点，跳过当前卡住的位置
async function goToNextUncompleted(page) {
    return page.evaluate(() => {
        const chapters = Array.from(document.querySelectorAll('.catalogItem'));
        // 找到当前所在的章节
        let curIdx = chapters.findIndex(ch => {
            const header = ch.querySelector('.basic.chapter');
            return header && header.classList.contains('active');
        });
        if (curIdx === -1) {
            curIdx = chapters.findIndex(ch => ch.querySelector('.oneline.active, .basic.active'));
        }

        // 1) 先在当前章节内找未完成的 section/point（非当前 active 的）
        if (curIdx >= 0) {
            const curChapter = chapters[curIdx];
            // 找当前 active 的 section/point 的 <li>
            const activeEl = curChapter.querySelector('.oneline.active');
            const activeLi = activeEl ? activeEl.closest('li') : null;
            // 在当前章节内所有 .basic.uncomplete 中找一个不是当前 active 的
            const uncompleted = curChapter.querySelectorAll('.basic.uncomplete');
            for (const uc of uncompleted) {
                // 跳过章节级别的 header 本身
                if (uc.classList.contains('chapter')) continue;
                // 跳过当前 active 的元素
                if (uc.classList.contains('active')) continue;
                const li = uc.closest('li');
                if (li && li === activeLi) continue;
                const label = uc.querySelector('.oneline') || uc;
                try { label.scrollIntoView({ block: 'center' }); } catch {}
                label.click();
                console.log('⏩ 跳到当前章节内未完成节点：', label.innerText.trim());
                return true;
            }
        }

        // 2) 从当前章节往后找第一个 uncomplete 的章节
        for (let i = curIdx + 1; i < chapters.length; i++) {
            const header = chapters[i].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[i].querySelector('.oneline');
                if (label) {
                    try { label.scrollIntoView({ block: 'center' }); } catch {}
                    label.click();
                    console.log('⏩ 前进到未完成章节：', label.innerText.trim());
                    return true;
                }
            }
        }
        // 3) 往后没找到，从头开始找（可能前面有漏掉的）
        for (let i = 0; i < curIdx; i++) {
            const header = chapters[i].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[i].querySelector('.oneline');
                if (label) {
                    try { label.scrollIntoView({ block: 'center' }); } catch {}
                    label.click();
                    console.log('🔄 回到未完成章节：', label.innerText.trim());
                    return true;
                }
            }
        }
        return false;
    });
}

// 往前查找最近的未完成章节（章级别 .catalogItem），点击展开
async function goToPrevUncompleted(page) {
    return page.evaluate(() => {
        const chapters = Array.from(document.querySelectorAll('.catalogItem'));
        // 找到当前所在的章节
        let curIdx = chapters.findIndex(ch => {
            const header = ch.querySelector('.basic.chapter');
            return header && header.classList.contains('active');
        });
        if (curIdx === -1) {
            // 可能当前 active 在子节点上，通过 stateParams 匹配
            curIdx = chapters.findIndex(ch => ch.querySelector('.oneline.active, .basic.active'));
        }
        if (curIdx >= 0) {
            const chapter = chapters[curIdx];
            const active = Array.from(chapter.querySelectorAll('.basic.active')).at(-1);
            const earlier = Array.from(chapter.querySelectorAll('.basic.uncomplete'))
                .filter(el => !el.classList.contains('chapter') && active &&
                    !el.contains(active) && (el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING));
            const target = earlier.at(-1);
            if (target) {
                const label = target.querySelector('.oneline') || target;
                label.scrollIntoView({ block: 'center' });
                label.click();
                return true;
            }
        }
        // 从当前章节往前找第一个 uncomplete 的章节
        for (let i = curIdx - 1; i >= 0; i--) {
            const header = chapters[i].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[i].querySelector('.oneline');
                if (label) {
                    try { label.scrollIntoView({ block: 'center' }); } catch {}
                    label.click();
                    console.log('🔙 回退到未完成章节：', label.innerText.trim());
                    return true;
                }
            }
        }
        return false;
    });
}

// 单个课程的完整学习流程（在独立 page 上运行）
async function learnCourseOnce(page, courseId, log) {
    const videoOnly = process.env.UOOC_VIDEO_ONLY === '1';
    const tracker = new VideoTracker(courseId, log);
    // 顺便收集视频字幕（用于回答"视频细节题"；导论那类命名猜不到的靠它兜底）
    try { attachCollector(page, courseId, log); } catch { }

    log('🎓 开始自动学习...');
    if (process.env.UOOC_SUPERVISED === '1') log('👁 实时监督模式：每份测验先独立复核，收到整卷确认后才填写和提交');
    await initSectionList(page);

    let quizRetries = 0;
    const MAX_QUIZ_RETRIES = 3;
    let gatelockRetries = 0;
    const MAX_GATELOCK_RETRIES = 10;

    // 主循环的另一道保险：页面长时间毫无变化 → 判定卡死并退出
    // （刷视频/答题时主循环是阻塞的，不会误判；能转到这里说明真的没在干活）
    let lastSig = '', sameSig = 0;

    while (true) {
        await page.waitForTimeout(3000);

        try {
            const sig = await page.evaluate(() =>
                location.hash + '|' + String((document.querySelector('.oneline.active') || {}).innerText || '').slice(0, 40)
            );
            if (sig && sig === lastSig) {
                sameSig += 1;
                if (sameSig >= 20) {            // 20 × 3s = 60 秒
                    log('⚠️ 页面 60 秒没有任何变化，判定卡住 → 结束这门课（重跑可继续）');
                    break;
                }
            } else {
                sameSig = 0;
                lastSig = sig;
            }
        } catch { }

        // 检测"测验通过"弹窗，点确定后直接跳到下一节
        const quizPassed = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('.layui-layer-content');
            for (const d of dialogs) {
                if (d.innerText.includes('测验通过')) return true;
            }
            return false;
        });
        if (quizPassed) {
            log('✅ 检测到测验已通过');
            // 点击确定按钮关闭弹窗
            try {
                const okBtn = page.locator('.layui-layer-btn0');
                if (await okBtn.count() > 0) await okBtn.first().click();
            } catch {}
            await page.waitForTimeout(1000);
            quizRetries = 0;
            if (!await goToNextSection(page)) {
                if (await goToNextUncompleted(page)) {
                    log('⏩ 跳转到其他未完成章节...');
                    continue;
                }
                log('🏁 已完成所有章节');
                break;
            }
            continue;
        }

        const isQuiz = await page.evaluate(() => {
            if (document.querySelector('video')) return false;
            const active = document.querySelector('.oneline.active') || document.querySelector('.oneline.ng-binding.active');
            if (active) {
                const t = active.innerText.trim();
                if (t.includes('测验') || t.includes('测试')) return true;
            }
            const text = document.body.innerText;
            return text.includes('提交') || text.includes('开始测验') || text.includes('重新测验');
        });

        if (isQuiz) {
            if (videoOnly) {
                log('⏭️ 暂留测验提交机会，继续后续可访问视频');
                if (!await goToNextSection(page) && !await goToNextUncompleted(page)) break;
                continue;
            }
            if (quizRetries >= MAX_QUIZ_RETRIES) {
                log('⚠️ 测验重试次数已达上限，跳过本节');
                quizRetries = 0;
                if (!await goToNextSection(page)) {
                    if (await goToNextUncompleted(page)) {
                        log('⏩ 跳转到其他未完成章节...');
                        continue;
                    }
                    log('🏁 已完成所有章节');
                    break;
                }
                continue;
            }
            quizRetries++;
            await page.evaluate(() => {
                for (const block of document.querySelectorAll('.basic')) {
                    const tag = block.querySelector('.tag-source-name');
                    if (!tag) continue;
                    const t = tag.innerText.trim();
                    if (t.includes('测验') || t.includes('测试')) {
                        try { block.scrollIntoView({ block: 'center' }); } catch {}
                        block.click();
                        return;
                    }
                }
            });
            const quizResult = await processQuizQuestions(page, log, courseId);
            if (quizResult?.status === 'recovering') return quizResult;
            if (quizResult?.status === 'blocked') return quizResult;
            log('⏭️ 测验处理完毕');
        }

        if (await tracker.findUnwatchedVideo(page)) {
            quizRetries = 0;
            gatelockRetries = 0;
            log('📺 播放未看视频...');
            const finished = await tracker.playVideo(page);
            if (!finished) return { status: 'blocked', reason: '视频播放未完成，未写入观看记录' };
            await tracker.markCurrentWatched(page);
            await page.waitForTimeout(3000);
        } else {
            // 检测闯关模式锁定或空子文件夹，自动跳过
            const skipReason = await page.evaluate(() => {
                // 闯关模式：页面上任意 .unfoldInfo 包含关键词即触发（ng-if 保证只有当前 section 的会渲染）
                for (const hint of document.querySelectorAll('.unfoldInfo')) {
                    const text = hint.innerText || '';
                    if (text.includes('闯关模式') || text.includes('请先完成之前')) return 'gatelock';
                }
                // 空子节点：只检查最深层 active 节点自身所在 <li>，避免误匹配父级 section 的提示
                const allActive = document.querySelectorAll('.oneline.active');
                const activeOneline = allActive.length ? allActive[allActive.length - 1] : null;
                if (activeOneline) {
                    const activeLi = activeOneline.closest('li');
                    if (activeLi) {
                        const hint = activeLi.querySelector(':scope > .unfoldInfo');
                        if (hint && (hint.innerText || '').includes('点击下方继续学习')) return 'empty';
                    }
                }
                return null;
            });
            if (skipReason === 'empty') {
                if (videoOnly) { if (!await goToNextSection(page) && !await goToNextUncompleted(page)) break; continue; }
                log('⏭️ 空子节点，跳过...');
                quizRetries = 0;
                if (!await goToNextSection(page)) {
                    if (await goToNextUncompleted(page)) {
                        log('⏩ 跳转到其他未完成章节...');
                        continue;
                    }
                    log('🏁 已完成所有章节');
                    break;
                }
                continue;
            }
            if (skipReason === 'gatelock') {
                const fs = require('fs'), path = require('path');
                const directory = path.join(require('./config').DATA_DIR, 'gate-diagnostics');
                fs.mkdirSync(directory, { recursive: true });
                await page.screenshot({ path: path.join(directory, `${courseId}.png`), fullPage: true });
                fs.writeFileSync(path.join(directory, `${courseId}.json`), JSON.stringify(await page.evaluate(() => ({
                    url: location.href,
                    hints: Array.from(document.querySelectorAll('.unfoldInfo')).map(el => el.innerText),
                    nodes: Array.from(document.querySelectorAll('.basic')).map(el => ({
                        classes: el.className, text: (el.querySelector('.oneline')?.innerText || el.innerText).trim().slice(0,180)
                    }))
                })), null, 2));
                if (videoOnly) return { status: 'blocked', reason: '后续视频要求先完成前置测验，未绕过平台限制' };
                gatelockRetries++;
                if (gatelockRetries > MAX_GATELOCK_RETRIES) {
                    log('⚠️ 闯关模式回退次数已达上限，跳过本节');
                    gatelockRetries = 0;
                    if (!await goToNextSection(page)) {
                        if (await goToNextUncompleted(page)) {
                            log('⏩ 跳转到其他未完成章节...');
                            continue;
                        }
                        log('🏁 已完成所有章节');
                        break;
                    }
                    continue;
                }
                log(`🔒 闯关模式锁定，往前查找未完成节点 (${gatelockRetries}/${MAX_GATELOCK_RETRIES})...`);
                quizRetries = 0;
                if (!await goToPrevUncompleted(page)) {
                    log('⚠️ 未找到前置未完成节点，已保存目录证据，停止无效跳转');
                    return { status: 'blocked', reason: '前置任务锁定，目录证据已保存至gate-diagnostics' };
                    gatelockRetries = 0;
                    if (!await goToNextSection(page)) {
                        if (await goToNextUncompleted(page)) {
                            log('⏩ 跳转到其他未完成章节...');
                            continue;
                        }
                        log('🏁 已完成所有章节');
                        break;
                    }
                }
                continue;
            }

            if (!videoOnly && await clickQuizTaskIfAvailable(page)) {
                log('📝 处理测验任务...');
                const quizResult = await processQuizQuestions(page, log, courseId);
                if (quizResult?.status === 'recovering') return quizResult;
                if (quizResult?.status === 'blocked') return quizResult;
                continue;
            }

            quizRetries = 0;
            log('⏭️ 进入下一节...');
            if (videoOnly) { if (!await goToNextSection(page) && !await goToNextUncompleted(page)) break; continue; }
            if (!await goToNextSection(page)) {
                // goToNextSection 失败，尝试跳到其他未完成章节
                if (await goToNextUncompleted(page)) {
                    log('⏩ 跳转到其他未完成章节...');
                    continue;
                }
                log('🏁 已完成所有章节');
                break;
            }
        }
    }
    const remaining = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.basic.uncomplete'))
            .map(el => (el.innerText || '').trim()).filter(Boolean)
    );
    if (videoOnly) return { status: 'incomplete', remaining, reason: '本轮仅推进可访问视频，测验和最终成绩仍须完成与核对' };
    return { status: remaining.length ? 'incomplete' : 'unverified', remaining,
        reason: remaining.length ? '页面仍有未完成节点' : '目录遍历结束，须核对平台课程完成状态' };
}

async function learnCourse(page, courseId, log) {
    const guard = require('./navigation-guard');
    await guard.install(page, courseId, log);
    try {
        for (let attempt = 0; attempt < 4; attempt++) {
            await guard.ensure(page);
            const before = guard.revision(page);
            try {
                const result = await learnCourseOnce(page, courseId, log);
                if (result?.status !== 'recovering' && guard.revision(page) === before) return result;
            } catch (error) {
                if (guard.revision(page) === before) throw error;
            }
            await guard.ensure(page);
            log('↩️ 页面已恢复，重新读取平台勾选状态，不沿用被打断的测验答案');
        }
        return { status: 'blocked', reason: '多次页面恢复未稳定，请核对窗口状态' };
    } finally { guard.dispose(page); }
}
module.exports = { learnCourse };
