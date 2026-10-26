const path = require('path');
const fs = require('fs');
const { DATA_DIR, ENSEMBLE_MODELS, ENSEMBLE_MIN_AGREE, JUDGE_MODEL,
    SUBMIT_MODE, VERIFY_SECOND_PASS, VERIFY_MODEL, VERIFY_ALLOW_UNCERTAIN,
    VERIFY_MAX_ROUNDS, ON_UNCERTAIN, ON_EMPTY, courseSetting } = require('./config');
const { locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { getEnsembleAnswers, isBlankType } = require('./module');

// 首轮投票：并行投票，取多数
const VOTE_BASE = { models: ENSEMBLE_MODELS, reasoningEffort: 'medium' };
// 重做时升级：全部模型 + 高推理强度 + 分歧必裁决
const VOTE_ESCALATED = { models: ENSEMBLE_MODELS, reasoningEffort: 'high', minAgree: ENSEMBLE_MIN_AGREE, useJudge: true };

// 显式配置的复核模型优先；相同模型的复核不宣称是独立模型投票。
const VERIFY_MODELS = (() => {
    if (VERIFY_MODEL) return [VERIFY_MODEL];
    const other = ['glm-4.5v', 'glm-4v', 'glm-4.6v-flash'].find(m => !ENSEMBLE_MODELS.includes(m));
    return other ? [other] : ENSEMBLE_MODELS;
})();
const VERIFY_VOTE = { models: VERIFY_MODELS, reasoningEffort: 'medium' };

// 两次答案是否算「一致」：
//   全是选项字母 → 按集合比较（多选 ABCD 顺序无关）
//   含文字（填空题）→ 按顺序比较（多个空的先后不能错）
function sameAnswer(a, b) {
    const norm = arr => (arr || []).map(x => String(x).trim()).map(t =>
        /^[A-Ha-h][.、．]?$/.test(t) ? t[0].toUpperCase() : t.toLowerCase().replace(/[\s（）()【】\[\]{}]/g, ''));
    const A = norm(a), B = norm(b);
    if (A.length !== B.length) return false;
    if ([...A, ...B].every(t => /^[A-H]$/.test(t))) {
        const sA = [...A].sort(), sB = [...B].sort();
        return sA.every((v, i) => v === sB[i]);
    }
    return A.every((v, i) => v === B[i]);
}

// 提交前的最后一道闸门（纯函数，便于单测）
// UOOC 只有一次提交机会：宁可停下让你人工看，也不要把没把握的卷子交出去
function decideSubmit({ mode, total, empty, uncertain, allowUncertain, onUncertain, onEmpty }) {
    if (mode === 'manual') return { ok: false, reason: '提交模式=manual（永不自动提交）' };
    if (!total) return { ok: false, reason: '没识别到题目' };
    if (mode === 'auto') return { ok: true, reason: '提交模式=auto（不做复核拦阻）' };
    // 只有"这题压根没答案"才算真失败（交出去必然 0 分）；DOM 检测仅供参考，不作为拦阻依据
    if (empty > 0 && onEmpty !== 'force') {
        return { ok: false, reason: '有 ' + empty + ' 题完全没拿到答案（交出去这题必然 0 分）' };
    }
    if (onUncertain === 'stop' && uncertain > allowUncertain) {
        return { ok: false, reason: '有 ' + uncertain + ' 题没复核通过（允许 ' + allowUncertain + ' 题）' };
    }
    return {
        ok: true,
        reason: '全部 ' + total + ' 题都有答案' + (uncertain ? '（其中 ' + uncertain + ' 题为最高票决定，已记入报告）' : '，且复核一致')
    };
}

// 累计多张选票，找出"严格多数"（票数 > 总票数的一半）
// 凑不出多数时返回最高票（best），由调用方决定怎么标注
function countVotes(votes) {
    const groups = [];
    for (const v of votes) {
        if (!v || !v.length) continue;
        const hit = groups.find(g => sameAnswer(g.answers, v));
        if (hit) hit.n++;
        else groups.push({ answers: v, n: 1 });
    }
    if (!groups.length) return { majority: null, best: null, counts: [] };
    groups.sort((a, b) => b.n - a.n);
    const total = groups.reduce((s, g) => s + g.n, 0);
    const top = groups[0];
    return {
        majority: top.n * 2 > total ? top.answers : null,
        best: top.answers,
        counts: groups.map(g => ({ answers: g.answers, n: g.n }))
    };
}

// 判断这一题在页面上是否真的已作答（防"以为填了其实没填"）
async function isAnswered(q, isBlank) {
    try {
        return await q.evaluate((el, blank) => {
            if (el.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;
            if (el.querySelector('.ti-a.active, .ti-a.selected, .ti-a.checked')) return true;
            if (blank) {
                const fields = [...el.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]')];
                return fields.length > 0 && fields.every(f =>
                    String(f.value !== undefined ? f.value : f.textContent || '').trim().length > 0);
            }
            return false;
        }, isBlank);
    } catch { return false; }
}

// 把每题答案与置信情况写成报告，方便提交前人工扫一眼
function writeQuizReport(courseId, results) {
    const lines = results.map((r, i) => '第 ' + (i + 1) + ' 题  [' + r.type + ']  ' + (r.confident ? '✅ 已确认' : '⚠️ 不确定') + '  ' + (r.why || '') + '\n        答案: ' + ((r.answers || []).join(' | ') || '(空)'));
    const body = 'UOOC 测验作答报告\n课程ID: ' + courseId + '\n时间: ' + new Date().toLocaleString()
        + '\n提交模式: ' + SUBMIT_MODE + ' | 二次复核: ' + (VERIFY_SECOND_PASS ? '开' : '关') + ' | 复核模型: ' + VERIFY_MODELS.join(',')
        + '\n\n' + lines.join('\n\n') + '\n';
    const p = path.join(DATA_DIR, 'quiz_report_' + courseId + '.txt');
    try { fs.writeFileSync(p, body); } catch { }
    return p;
}

async function clickQuizTaskIfAvailable(page) {
    return page.evaluate(() => {
        for (const block of document.querySelectorAll('.basic')) {
            if (block.classList.contains('complete') || block.dataset.quizHandled === '1') continue;
            const tag = block.querySelector('.tag-source-name');
            if (!tag) continue;
            const label = tag.innerText.trim().replace(/\s+/g, '');
            if (!label.includes('测验') && !label.includes('测试') && !label.toLowerCase().includes('quiz')) continue;
            try { block.scrollIntoView({ block: 'center' }); } catch {}
            block.click();
            block.dataset.quizHandled = '1';
            return true;
        }
        return false;
    });
}

async function processQuizQuestions(page, log, courseId) {
    const navigation = require('./navigation-guard');
    await navigation.ensure(page);
    const navigationRevision = navigation.revision(page);
    const screenshotPath = path.join(DATA_DIR, `image_${courseId}.png`);

    log('🧩 开始处理测验...');

    const locate = (sel) => locateInAnyFrame(page, sel);

    // 等测验页真正出来再动手。原来这里是「固定等 5 秒 → 找不到 [提交试卷] 就跳过」，
    // 页面加载一慢（SPA 路由切换、服务端渲染慢）就会扑空，结果整个测验被跳过。
    let submitPaperBtn = null;
    const deadline = Date.now() + 25000;
    let waited = 0;
    while (Date.now() < deadline) {
        submitPaperBtn = await locate('button:has-text("提交试卷")');
        if (submitPaperBtn) break;
        await page.waitForTimeout(1000);
        waited += 1;
        if (waited === 8) log('   ⏳ 测验页还没出来，继续等…');
    }
    if (!submitPaperBtn) {
        log('⚠️ 等了 25 秒仍未出现 [提交试卷]，跳过这个测验（已存截图便于排查）');
        try { await page.screenshot({ path: path.join(DATA_DIR, `quiz_not_ready_${courseId}.png`) }); } catch { }
        return { status: 'blocked', reason: '测验页面未加载' };
    }
    log(`✅ 发现 [提交试卷]（等了约 ${waited}s），开始做题...`);

    let quizPassed = false;
    const results = [];   // 每题的作答与置信情况，提交前闸门要用

    // ⚠️ UOOC 只有一次提交机会 → 不做"重做"尝试。
    // 原来 MAX_ATTEMPTS=2 建立在"可以重新提交"的假设上，已废弃。
    const MAX_ATTEMPTS = 1;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const isRetry = attempt > 0;
        let modelOptions = isRetry ? VOTE_ESCALATED : VOTE_BASE;

        if (isRetry) {
            log(`🔄 重做测验（第 ${attempt + 1} 次尝试，升级为全模型高推理投票）...`);
            await clearAllSelections(page, log);
            await page.waitForTimeout(2000);
        }

        let questions = await findQuestions(page, log);
        if (questions.length === 0) {
            await page.waitForTimeout(5000);
            questions = await findQuestions(page, log);
        }
        if (questions.length === 0) {
            log('⚠️ 未找到题目');
            await page.screenshot({ path: `debug_quiz_fail_${courseId}.png` });
            break;
        }

        log(`   共 ${questions.length} 道题目`);

        // 核验模式仅保存题面，不填答、不提交。
        if (process.env.UOOC_CAPTURE_QUIZ_DIR) {
            const dir = path.resolve(process.env.UOOC_CAPTURE_QUIZ_DIR);
            fs.mkdirSync(dir, { recursive: true });
            const captured = [];
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i];
                const image = path.join(dir, `question-${i + 1}.png`);
                await q.screenshot({ path: image });
                captured.push({ index: i + 1, text: await q.innerText(), image });
            }
            fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify({ courseId,
                examUrls: page.frames().map(f => f.url()).filter(url => /\/exam\/\d+/.test(url)),
                capturedAt: new Date().toISOString(), questions: captured }, null, 2), 'utf8');
            log(`   已保存题面至 ${dir}，核验模式不提交`);
            return { status: 'blocked', reason: '题面核验模式' };
        }

        // 首次答题前：检测是否已有选项被选中（测验做过但未提交/通过）
        if (!isRetry) {
            let hasExistingSelections = false;
            for (const q of questions) {
                const selected = await q.evaluate(el =>
                    el.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked') !== null
                );
                if (selected) { hasExistingSelections = true; break; }
            }
            if (hasExistingSelections) {
                log(`⚠️ 检测到已有选中项（测验做过但未提交/通过），先清空所有选项，升级为全模型高推理投票...`);
                await clearAllSelections(page, log);
                await page.waitForTimeout(1000);
                modelOptions = VOTE_ESCALATED;
            }
        }

        // 把课程ID带下去，供「字幕检索」用（用来回答"视频细节题"）
        if (courseId) modelOptions.courseId = courseId;

        // 答题
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            log(`   📸 第 ${i + 1}/${questions.length} 题`);
            if (process.env.UOOC_SUPERVISED === '1') {
                results.push({ type: await detectQuestionType(q), answers: [], confident: false, answered: false,
                    questionText: await q.innerText(), why: '实时监督模式：等待独立核验整份试卷，尚未作答或提交' });
                continue;
            }

            let originalText = '';
            try {
                originalText = await q.innerText();
                // Model calls already have abortable bounded timeouts. Await the whole task;
                // abandoning a Promise.race allowed a late answer to mutate the form later.
                const r = await answerOneQuestion(q, page, log, screenshotPath, { ...modelOptions, questionIndex: i + 1 });
                r.answered = await isAnswered(q, r.type === '填空题');
                r.questionText = originalText;
                if (await q.innerText() !== originalText) {
                    r.confident = false;
                    r.why = '作答期间题干或选项发生变化，需重新确认';
                }
                results.push(r);
            } catch (e) {
                log(`      ❌ 失败: ${e.message}`);
                results.push({ type: '未知', answers: [], confident: false, why: '答题异常：' + e.message, answered: false, questionText: originalText });
            }

            await page.waitForTimeout(2000);
        }

        await navigation.ensure(page);
        if (navigation.revision(page) !== navigationRevision) return { status: 'recovering', reason: '页面恢复后重新读取题目' };
        // Check all earlier answers again: the platform can replace/reorder DOM while loading.
        for (let i = 0; i < results.length; i++) {
            if (results[i].questionText !== await questions[i].innerText()) {
                results[i].confident = false;
                results[i].why = '作答后题干或选项变化，旧答案不得直接提交';
            }
        }
        // ---- 提交前闸门：一次性提交的关键保险 ----
        const reportPath = writeQuizReport(courseId, results);
        log(`   📄 作答报告: ${reportPath}`);
        const empty = results.filter(r => !r.answers || r.answers.length === 0 || !r.answered).length;
        const domUnfilled = results.filter(r => !r.answered).length;                        // DOM 检测仅供参考
        const bad = results.map((r, i) => ({ i: i + 1, r })).filter(x => !x.r.confident);
        // 允许按课程单独放宽（例如计算机导论只需过线）
        const mode = String(courseSetting(courseId, 'SUBMIT_MODE', SUBMIT_MODE)).trim().toLowerCase();
        const allowUncertain = (() => {
            const n = parseInt(courseSetting(courseId, 'VERIFY_ALLOW_UNCERTAIN', String(VERIFY_ALLOW_UNCERTAIN)), 10);
            return Number.isFinite(n) && n >= 0 ? n : VERIFY_ALLOW_UNCERTAIN;
        })();
        let gate = decideSubmit({
            mode, total: results.length,
            empty, uncertain: bad.length, allowUncertain,
            onUncertain: ON_UNCERTAIN, onEmpty: ON_EMPTY
        });
        log(`   🚦 提交闸门：${gate.ok ? '放行' : '拦住'}（${gate.reason} · 模式 ${mode}）`);
        if (domUnfilled) log(`   ℹ️ DOM 检测显示 ${domUnfilled} 题没看到选中痕迹（仅参考，模型已给答案时不算失败）`);
        if (bad.length) log(`   ℹ️ 以下 ${bad.length} 题由最高票决定（已记入报告）：` + bad.map(x => '第 ' + x.i + ' 题').join('、'));
        if (!gate.ok) {
            if (process.env.UOOC_HUMAN_REVIEW !== '0' && results.some(r => !r.confident || !r.answered)) {
                const examIds = page.frames().map(frame => frame.url().match(/\/exam\/(\d+)/)?.[1]).filter(Boolean);
                const topExam = page.url().match(/\/exam\/(\d+)/)?.[1];
                if (topExam) examIds.push(topExam);
                const pendingQuestions = [];
                for (let i = 0; i < results.length; i++) {
                    if (results[i].confident && results[i].answered) continue;
                    pendingQuestions.push({ questionIndex: i + 1, text: await questions[i].innerText(),
                        choices: await questions[i].locator('.ti-a').allTextContents(), type: await detectQuestionType(questions[i]),
                        blankCount: await questions[i].locator('textarea, input[type="text"], input:not([type])').count(), why: results[i].why });
                }
                const review = require('./human-review');
                const reviewDir = process.env.UOOC_HUMAN_REVIEW_DIR || path.join(DATA_DIR, 'human-review');
                const pending = review.publishRequest(reviewDir, courseId, examIds, pendingQuestions);
                const decisions = await review.waitForReply(pending, page, log);
                if (decisions.takeover) {
                    await navigation.pause(page);
                    require('./submission').reserveSubmission(DATA_DIR, courseId, examIds);
                    log('🙋 已交给你接管测验，脚本不再填写或点击提交；网页完成后在窗口输入“继续”。');
                    const result = await review.waitForTakeover(pending, page, log, {
                        observe: async () => !!await locate('.layui-layer-content:has-text("测验通过")'),
                        inspect: async () => {
                            if (await locate('.layui-layer-content:has-text("测验通过")')) return true;
                            const grade = await require('./grade-watch').inspectGrade(page.context(), String(courseId), pending.request.examId, path.join(DATA_DIR, 'manual-grades'));
                            return grade === 100;
                        }
                    });
                    await navigation.resume(page);
                    return result;
                }
                for (const decision of decisions) {
                    const q = questions[decision.questionIndex - 1];
                    const original = pendingQuestions.find(item => item.questionIndex === decision.questionIndex);
                    if (await q.innerText() !== original.text || JSON.stringify(await q.locator('.ti-a').allTextContents()) !== JSON.stringify(original.choices)) {
                        throw Error('等待期间题目或选项变化，拒绝使用旧答复');
                    }
                    if (original.choices.length) {
                        if (original.type === '多选题') {
                            for (const option of await q.locator('.ti-a').all()) {
                                if (await option.evaluate(el => el.matches('.active,.selected,.checked') || !!el.querySelector('input:checked'))) await option.click();
                            }
                        }
                        await clickAnswers(q, decision.answers, log);
                    }
                    else await fillBlankAnswers(q, decision.answers, log);
                    results[decision.questionIndex - 1] = { type: original.type, answers: decision.answers, confident: true,
                        answered: await isAnswered(q, !original.choices.length), why: '独立复核：' + decision.evidence };
                }
                writeQuizReport(courseId, results);
                gate = decideSubmit({ mode: mode === 'manual' ? 'manual' : 'verify', total: results.length,
                    empty: results.filter(r => !r.answers?.length || !r.answered).length,
                    uncertain: results.filter(r => !r.confident).length, allowUncertain: 0,
                    onUncertain: 'stop', onEmpty: 'stop' });
                log(`🚦 用户确认后重新检查：${gate.ok ? '放行' : '拦住'}（${gate.reason}）`);
            }
        }
        if (!gate.ok) {
            if (bad.length) {
                log('   ⚠️ 下面这些题需要你人工核对：');
                bad.forEach(x => log(`       第 ${x.i} 题 [${x.r.type}] 我答的是「${(x.r.answers || []).join(',') || '空'}」—— ${x.r.why}`));
            }
            if (empty) log(`   ⚠️ 有 ${empty} 题完全没拿到答案，交出去必然 0 分`);
            try { await page.screenshot({ path: `quiz_before_submit_${courseId}.png` }); } catch { }
            log(`   📷 已存 quiz_before_submit_${courseId}.png`);
            log('   🛑 已保留页面、不提交 —— 请你核对后再手动点「提交试卷」');
            break;
        }

        // Recheck the entire live form before reserving or attempting a submission.
        try {
            for (let i = 0; i < results.length; i++) {
                if (await questions[i].locator('.ti-a').count()) await require('./choice-actions').verifyChoices(questions[i], results[i].answers);
            }
        } catch (error) {
            log('🛑 提交前答案核对失败，未提交：' + error.message);
            return { status: 'blocked', reason: error.message };
        }
        // 提交试卷
        log('📝 提交试卷...');
        try {
            const btn = await locate('button:has-text("提交试卷")');
            if (!btn) { log('⚠️ 找不到提交按钮，停止'); break; }
            const examIds = page.frames().map(frame => frame.url().match(/\/exam\/(\d+)/)?.[1]).filter(Boolean);
            const topExam = page.url().match(/\/exam\/(\d+)/)?.[1];
            if (topExam) examIds.push(topExam);
            await navigation.ensure(page);
            if (navigation.revision(page) !== navigationRevision) return { status: 'recovering', reason: '恢复页面后取消旧试卷提交' };
            await navigation.pause(page);
            require('./submission').reserveSubmission(DATA_DIR, courseId, examIds);
            await btn.click();
        } catch (error) {
            log(`🛑 提交已尝试、无法确认或存在历史提交记录，禁止重复点击：${error.message}`);
            break;
        }
        await page.waitForTimeout(3000);

        if (!await confirmQuizSubmission(page, log, locate, { courseId, examIds: page.frames().map(frame => frame.url().match(/\/exam\/(\d+)/)?.[1]).filter(Boolean) })) {
            break;
        }

        // 检查分数
        await page.waitForTimeout(3000);
        const failMsg = await checkFailDialog(page, log);

        if (failMsg) {
            log(`⚠️ 测验未通过: ${failMsg}`);
            if (attempt < MAX_ATTEMPTS - 1) {
                await page.waitForTimeout(4000);
                continue;
            } else {
                log('⚠️ 本次未通过（UOOC 只有一次提交机会，脚本不重试）');
            }
        } else {
            log('✅ 测验提交成功');
            await navigation.resume(page);
            quizPassed = true;
            break;
        }
    }

    // 不通过时不再暴力遍历选项组合，保持答案可信度
    if (!quizPassed) log('⚠️ 测验未确认通过；请先核对平台记录，勿重复提交');

    await page.waitForTimeout(3000);
    return { status: quizPassed ? 'submitted' : 'blocked', reason: quizPassed ? '' : '测验未提交或未通过' };
}

// 答一道题：截图 → 多模型并行投票
async function answerOneQuestion(q, page, log, screenshotPath, modelOptions = {}) {
    const navigation = require('./navigation-guard'), navigationRevision = navigation.revision(page);
    for (let retry = 0; ; retry++) {
        try { await q.scrollIntoViewIfNeeded({ timeout: 5000 }); break; }
        catch (error) {
            if (retry >= 2 || !/attached|visible|detached/i.test(error.message)) throw error;
            await page.waitForTimeout(1000);
        }
    }
    modelOptions = { ...modelOptions, context: '', questionText: await q.innerText() };
    await page.waitForTimeout(1000);

    const questionType = await detectQuestionType(q);
    const isBlank = questionType === '填空题';
    log(`      类型: ${questionType}`);

    // Explicit user-reviewed content takes precedence over an unresolved question defect.
    const examIds = page.frames().map(frame => frame.url().match(/\/exam\/(\d+)/)?.[1]).filter(Boolean);
    const reviewed = require('./reviewed').reviewedAnswer(modelOptions.courseId, examIds,
        modelOptions.questionIndex, modelOptions.questionText, isBlank ? await q.locator('textarea, input[type="text"], input:not([type])').count() : 0);
    if (reviewed) {
        if (!isBlank && !reviewed.answerTexts) throw new Error('复核记录缺少选项内容，拒绝沿用旧字母');
        if (!isBlank) reviewed.answers = require('./reviewed').resolveChoiceAnswers(reviewed.answerTexts, await q.locator('.ti-a').allTextContents());
        if (isBlank) await fillBlankAnswers(q, reviewed.answers, log);
        else await clickAnswers(q, reviewed.answers, log);
        return { type: questionType, answers: reviewed.answers, confident: true, why: reviewed.evidence };
    }
    const typeIssue = require('./c-rules').printfTypeIssue(modelOptions.questionText);
    if (typeIssue) {
        log(`      🛑 题面类型问题：${typeIssue}`);
        return { type: questionType, answers: [], confident: false, why: typeIssue };
    }

    if (questionType === '单选题') {
        const choices = await q.locator('.ti-a').allTextContents();
        const verifier = require('./scanf');
        const verified = verifier.verifyScanfInput(modelOptions.questionText, choices)
            || verifier.verifyInputStream(modelOptions.questionText, choices)
            || require('./c-output').verifyCOutput(modelOptions.questionText, choices)
            || require('./c-rules').verifyDigitSplit(modelOptions.questionText, choices)
            || require('./c-rules').verifyKeywordError(modelOptions.questionText, choices);
        if (verified) {
            await clickAnswers(q, verified.answers, log);
            return { type: questionType, answers: verified.answers, confident: true, why: verified.evidence };
        }
    }

    const first = await recognizeWithEnsemble(q, screenshotPath, questionType, page, log, 3, modelOptions);
    if (!first || first.length === 0) {
        log('      ⚠️ 所有模型均未给出答案，该题留空（不猜）');
        return { type: questionType, answers: [], confident: false, why: '模型没给出答案' };
    }

    let answers = first;
    let confident = !first.hadDisagreement;
    let hadDisagreement = !!first.hadDisagreement;
    let why = '首答即确定';

    // ---- 独立复核 + 自动收敛：UOOC 只有一次提交机会，靠"多轮独立投票"把不确定自己消化掉 ----
    // 首答和复核一致则继续；出现分歧时由最终裁决决定，不要求弱模型全票一致。
    if (VERIFY_SECOND_PASS) {
        const votes = [first];
        let t = countVotes(votes);
        let resolved = false;
        for (let round = 1; round <= VERIFY_MAX_ROUNDS && !resolved; round++) {
            // 奇数轮用复核模型(glm-4.5v)，偶数轮用首答模型+高推理：让每票尽量"不同源"
            const opts = { ...(round % 2 === 1 ? VERIFY_VOTE : { models: ENSEMBLE_MODELS, reasoningEffort: 'high' }),
                courseId: modelOptions.courseId, context: modelOptions.context, questionText: modelOptions.questionText };
            const r = await recognizeWithEnsemble(q, screenshotPath, questionType, page, log, 1, opts);
            if (r && r.length) {
                hadDisagreement = hadDisagreement || !!r.hadDisagreement || !sameAnswer(first, r);
                votes.push(r);
            }
            t = countVotes(votes);
            const line = t.counts.map(c => (c.answers || []).join(',') + '×' + c.n).join('  ');
            if (t.majority) {
                answers = t.majority;
                resolved = true;
                confident = !hadDisagreement;
                why = hadDisagreement
                    ? '模型或复核轮次有分歧，重复裁决不能视为独立确认，须核对'
                    : '第 ' + votes.length + ' 票后多数一致（' + line + '）';
                log(`      🛡️ 多数一致 → ${answers.join(', ')}   [${line}]`);
            } else {
                log(`      ↻ 第 ${votes.length} 票仍无多数   [${line}]`);
            }
        }
        if (!resolved) {
            answers = t.best || first;
            confident = false;
            why = '凑不出多数，按最高票取「' + answers.join(',') + '」（' + t.counts.map(c => c.answers.join(',') + '×' + c.n).join(' / ') + '）';
            log('      ⚠️ 复核未收敛，交给最终裁决');
        }
    }

    if (!confident) {
        // 用户明确授权：裁决模型有最终决定权。此处的confident表示满足
        // 自动提交策略，不表示模型结果有满分保证。无响应仍不猜答案。
        log(`      ⚖️ 最终决策：${JUDGE_MODEL}，无需其他模型全票赞同`);
        const verdict = await recognizeWithEnsemble(q, screenshotPath, questionType, page, log, 1, {
            models: [JUDGE_MODEL], minAgree: 1, useJudge: false, reasoningEffort: 'high', decisionRequired: true,
            courseId: modelOptions.courseId, context: modelOptions.context,
            questionText: modelOptions.questionText
        });
        if (verdict?.length && !verdict.hadDisagreement) {
            answers = verdict;
            confident = true;
            why = `按用户授权采用最终裁决模型 ${JUDGE_MODEL} 的答案；模型判断不保证满分`;
            log('      ✅ ' + why);
        } else {
            why = '最终裁决仍不确定或无有效答案，等待手动输入或接管；未提交' + (verdict.reviewReason ? '：' + verdict.reviewReason : '');
            log('      🔔 ' + why);
        }
    }

    await navigation.ensure(page);
    if (navigation.revision(page) !== navigationRevision) throw Error('题目页面已恢复，旧模型答案已丢弃');
    if (isBlank) {
        const blankCount = await q.locator('textarea, input[type="text"], input:not([type])').count();
        if (!blankCount || answers.length !== blankCount) {
            return { type: questionType, answers: [], confident: false, why: '答案数量与页面空格数量不一致' };
        }
        await fillBlankAnswers(q, answers, log);
    } else {
        const choices = await q.locator('.ti-a').allTextContents();
        const letters = choices.map(text => String(text).trim().match(/^([A-H])[.、．]/)?.[1]);
        if (answers.some(answer => !letters.includes(answer))
            || ((questionType === '单选题' || questionType === '判断题') && answers.length !== 1)) {
            return { type: questionType, answers: [], confident: false, why: '模型答案与当前选项或题型不匹配' };
        }
        await clickAnswers(q, answers, log);
    }
    return { type: questionType, answers, confident, why };
}

// 点击选项
async function clickAnswers(q, answers, log) {
    return require('./choice-actions').clickChoices(q, answers, log);
}

// 填空题 / 程序填空题：把答案填进输入框
// （UOOC 的填空 DOM 我还没见过实物，所以这里用多套选择器兜底，失败就存截图 + 明确提示）
async function fillBlankAnswers(q, answers, log) {
    const SELECTORS = [
        'input[type="text"]', 'textarea', 'input:not([type])',
        '.ti-a input', '.el-input__inner', '[contenteditable="true"]'
    ];
    let fields = [];
    for (const sel of SELECTORS) {
        try { fields = await q.locator(sel).all(); } catch { fields = []; }
        if (fields.length) { log(`      填空输入框: ${sel} × ${fields.length}`); break; }
    }
    if (fields.length === 0) {
        log('      ⚠️ 没找到填空输入框（这个页面结构我还没见过）→ 该题留空');
        try {
            await q.screenshot({ path: 'debug_blank.png' });
            log('      📷 已存 debug_blank.png，请在待确认窗口输入答案，或选择接管网页测验');
        } catch {}
        return false;
    }
    let done = 0;
    for (let i = 0; i < fields.length; i++) {
        const val = answers[i] != null ? answers[i] : (i === 0 ? answers[0] : '');
        if (!val) continue;
        try {
            await fields[i].fill(val);
            done++;
            log(`      ✅ 第 ${i + 1} 空 ← ${val}`);
        } catch (e) {
            try {
                await fields[i].click();
                await fields[i].type(val);
                done++;
                log(`      ✅ 第 ${i + 1} 空 ← ${val}（逐字输入）`);
            } catch (e2) {
                log(`      ⚠️ 第 ${i + 1} 空填写失败: ${String(e2.message).split('\n')[0]}`);
            }
        }
    }
    if (done === 0) log('      ⚠️ 一个空都没填上，请检查页面结构');
    return done > 0;
}

function findQuestions(page, log) {
    return (async () => {
        let qs = await page.locator('.queContainer:visible').all();
        if (qs.length > 0) return qs;
        for (const frame of page.frames()) {
            try {
                qs = await frame.locator('.queContainer:visible').all();
                if (qs.length > 0) {
                    log('🔎 在 Iframe 中找到题目');
                    return qs;
                }
            } catch {}
        }
        return [];
    })();
}

async function detectQuestionType(q) {
    const typeText = await q.evaluate(el => {
        let curr = el.previousElementSibling;
        while (curr) {
            if (curr.classList.contains('queItems-type')) return curr.innerText;
            curr = curr.previousElementSibling;
        }
        return '';
    });
    if (typeText.includes('单选')) return '单选题';
    if (typeText.includes('多选')) return '多选题';
    if (typeText.includes('判断')) return '判断题';
    // 填空 / 程序填空 / 简答 / 论述：答案是文字，要打进输入框。
    // 原来这里统一落到'选择题'，于是填空题被当成选择题去点选项 → 点不到 → 得 0 分。
    if (isBlankType(typeText)) return '填空题';
    // 兜底：页面上**没有选项元素**的题，八成是填空/程序题（题型标签可能读不到或页面改版）。
    // 很关键——误判成选择题会让模型拿错提示词、返回空答案，整题就废了。
    try {
        const hasOptions = await q.locator('.ti-a').count() > 0;
        if (!hasOptions) {
            console.log('      ℹ️ 没读到题型标签，且页面上没有选项元素 → 按填空题处理');
            return '填空题';
        }
    } catch { }
    return '选择题';
}

async function recognizeWithEnsemble(q, screenshotPath, questionType, page, log, maxRetries = 3, modelOptions = {}) {
    if (/\b(?:printf|scanf|int|float|double|char)\b|\+\+|--/.test(modelOptions.questionText || '')) {
        modelOptions = { ...modelOptions, reasoningEffort: 'high' };
    }
    // 先用题干去课程字幕里检索相关片段，作为「视频细节题」的答题依据
    if (!modelOptions.context && modelOptions.courseId) {
        try {
            const { keywordsFromStem, buildContext } = require('./subtitles');
            const stem = await q.evaluate(el => el.innerText).catch(() => '');
            let ctx = buildContext(modelOptions.courseId, keywordsFromStem(stem), 1600);
            // 视频细节题优先使用当前章节文稿，避免依靠常识猜人物和数字。
            const title = await page.evaluate(() => {
                const el = document.querySelector('.oneline.active');
                return el ? el.innerText.trim().replace(/^\d+(\.\d+)*\s*/, '') : '';
            }).catch(() => '');
            if (title && title.length >= 3) {
                const { dirOf } = require('./subtitles');
                const dir = dirOf(modelOptions.courseId);
                const matches = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.txt') && f.includes(title)) : [];
                if (matches.length === 1) ctx = fs.readFileSync(path.join(dir, matches[0]), 'utf8').slice(0, 14000);
            }
            if (ctx) {
                modelOptions.context = ctx;
                log('   💬 已注入视频字幕片段 ' + ctx.length + ' 字');
            }
        } catch { }
    }
    for (let i = 0; i < maxRetries; i++) {
        await q.screenshot({ path: screenshotPath });

        const result = await getEnsembleAnswers(screenshotPath, questionType, log, modelOptions);
        if (result?.answers?.length > 0) {
            result.answers.hadDisagreement = !result.confident || !!result.judged;
            result.answers.reviewReason = result.detail?.find(item => item?.needsReview)?.reason || '';
            const tag = result.confident ? '✅ 一致' : (result.judged ? '⚖️ 裁决' : '⚠️ 多数票');
            log(`      🎯 ${tag} 答案: ${result.answers.join(', ')} (${result.agreement}/${result.total})`);
            return result.answers;
        }

        log(`      ⚠️ 投票失败 (${i + 1}/${maxRetries})`);
        if (i < maxRetries - 1) await page.waitForTimeout(2000);
    }
    return [];
}

async function checkFailDialog(page, log) {
    const checkFn = () => {
        // 检查 layui 弹窗
        for (const dialog of document.querySelectorAll('.layui-layer-content')) {
            const text = (dialog.innerText || '').trim();
            if (text.includes('请重新提交测验') || text.includes('重新提交')) return text;
        }
        // 全页面搜索关键词
        const body = (document.body && document.body.innerText) || '';
        if (body.includes('请重新提交测验')) return '请重新提交测验';
        return null;
    };

    try {
        // 检查主页面
        let msg = await page.evaluate(checkFn);
        if (msg) { log(`📊 检测到未通过提示: ${msg}`); return msg; }

        // 检查所有 iframe
        for (const frame of page.frames()) {
            try {
                msg = await frame.evaluate(checkFn);
                if (msg) { log(`📊 检测到未通过提示 (在 iframe 中): ${msg}`); return msg; }
            } catch {}
        }
        return null;
    } catch {
        return null;
    }
}

async function clearAllSelections(page, log) {
    log('🧹 清空所有已选选项...');

    // 取消勾选所有复选框
    const checkedCheckboxes = page.locator('input[type="checkbox"]:checked');
    const checkboxCount = await checkedCheckboxes.count();
    for (let i = 0; i < checkboxCount; i++) {
        try { await checkedCheckboxes.nth(i).uncheck({ force: true }); } catch {}
    }

    // 强制清空所有单选框
    await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
            radio.checked = false;
        });
    });

    // 同时处理 iframe 中的选项
    for (const frame of page.frames()) {
        try {
            await frame.evaluate(() => {
                document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                    cb.checked = false;
                });
                document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
                    radio.checked = false;
                });
            });
        } catch {}
    }

    log('✅ 已清空所有选项');
}

// 确认按钮最多点击一次；结果不明确时保留提交记录并停止。
async function confirmQuizSubmission(page, log, locate, metadata = {}) {
    const finalSubmitSelector = '#commitConfirmDialog [ng-click="vm.doCommitTask()"], div.btn.btn-warning:has-text("提交")';
    const passedSelector = '.layui-layer-content:has-text("测验通过")';
    const capturePass = async () => {
        const passed = await locate(passedSelector);
        if (!passed) return false;
        const feedback = typeof passed.innerText === 'function' ? await passed.innerText() : '测验通过';
        log('✅ 平台反馈：' + feedback);
        const ids = [...new Set(metadata.examIds || [])];
        if (/^\d+$/.test(String(metadata.courseId)) && ids.length === 1 && /^\d+$/.test(ids[0])) {
            fs.writeFileSync(path.join(DATA_DIR, `exam-feedback-${metadata.courseId}-${ids[0]}.json`),
                JSON.stringify({ courseId: metadata.courseId, examId: ids[0], feedback, capturedAt: new Date().toISOString() }, null, 2));
        }
        return true;
    };
    if (await capturePass()) return true;
    const verified = await handleCaptcha(page, locate, async () => {
            const btn = await locate(finalSubmitSelector);
            if (!btn) return false;
            return !(await btn.evaluate(el => el.classList.contains('disabled') || el.disabled));
        }, 10, log);
    if (!verified) { log('⚠️ 提交验证未通过，停止'); return false; }
        const finalBtn = await locate(finalSubmitSelector);
        if (!finalBtn) { log('⚠️ 无确认按钮且无通过证明，停止'); return false; }

        try {
            await finalBtn.click({ timeout: 5000 });
        } catch (e) {
            log(`❌ 提交失败: ${e.message}`);
            return false;
        }

    // Observe delayed platform feedback without repeating any click.
    for (let tick = 0; tick < 30; tick++) {
        await page.waitForTimeout(1000);
        if (await capturePass()) return true;
        if (await checkFailDialog(page, log)) return false;
    }
    log('⚠️ 30秒内未获得平台通过证明，停止，不再次点击');
    return false;
}

module.exports = { processQuizQuestions, clickQuizTaskIfAvailable, answerOneQuestion, countVotes, decideSubmit, sameAnswer, confirmQuizSubmission };   // 后几个导出是为了能单测
