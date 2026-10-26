const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveChoiceAnswers } = require('./reviewed');
function desktopNotice(message) {
    if (process.platform !== 'win32') return;
    const payload = Buffer.from(JSON.stringify({ title: 'UOOC：有题目需要你确认', message }), 'utf8').toString('base64');
    const script = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; $w=New-Object -ComObject WScript.Shell; $null=$w.Popup($p.message,60,$p.title,4160)`;
    const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { detached: false, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); child.unref();
}
function publishRequest(directory, courseId, examIds, questions, notify = desktopNotice) {
    const exams = [...new Set(examIds)];
    if (!courseId || exams.length !== 1) throw Error('无法唯一识别待确认测验');
    fs.mkdirSync(directory, { recursive: true });
    const fingerprint = questions.map(({ why, ...question }) => question);
    const requestId = crypto.createHash('sha256').update(JSON.stringify({ courseId, examId: exams[0], questions: fingerprint })).digest('hex').slice(0, 24);
    const request = { requestId, courseId: String(courseId), examId: exams[0], questions };
    const requestPath = path.join(directory, `${requestId}.request.json`);
    const replyPath = path.join(directory, `${requestId}.reply.json`);
    const notePath = path.join(directory, '待确认题目.md');
    fs.writeFileSync(requestPath, JSON.stringify(request, null, 2));
    fs.writeFileSync(notePath, '# UOOC 待确认题目\n\n脚本正在等待，尚未提交。请在慕课脚本窗口中确认答案。关闭提醒不会提交。\n\n'
        + questions.map(q => `## 第 ${q.questionIndex} 题\n\n${q.text}\n\n待确认原因：${q.why}\n`).join('\n')
        + `\n请求编号：${requestId}\n\n答复文件：${replyPath}\n`);
    // Notify once per pending request, including across restarts; requests remain on disk.
    try {
        fs.writeFileSync(requestPath + '.notified', '', { flag: 'wx' });
        notify(`有 ${questions.length} 道题需要确认。脚本已停在提交前。\n请打开：${notePath}\n在慕课脚本窗口中确认答案；关闭提醒不会提交。`);
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { request, requestPath, replyPath, notePath };
}
function validateReply(request, reply) {
    if (reply.requestId === request.requestId && reply.mode === 'takeover') return { takeover: true };
    if (reply.requestId !== request.requestId || !Array.isArray(reply.decisions)
        || reply.decisions.length !== request.questions.length) throw Error('答复编号或题目数量不匹配');
    const seen = new Set();
    return reply.decisions.map(decision => {
        const q = request.questions.find(item => item.questionIndex === decision.questionIndex);
        if (!q || seen.has(q.questionIndex) || typeof decision.evidence !== 'string' || !decision.evidence.trim()) throw Error('答复题号重复、未知或缺少确认说明');
        seen.add(q.questionIndex);
        let answers;
        if (q.choices.length) {
            if (!Array.isArray(decision.answerTexts) || !decision.answerTexts.length) throw Error('选择题须按选项内容确认');
            answers = resolveChoiceAnswers(decision.answerTexts, q.choices);
            if (new Set(answers).size !== answers.length || (/单选|判断/.test(q.type) && answers.length !== 1)) throw Error('答案数量与题型不符');
        } else {
            answers = decision.answers;
            if (!Array.isArray(answers) || answers.length !== q.blankCount || !answers.every(a => typeof a === 'string' && a.trim())) throw Error('填空答案不完整');
        }
        return { questionIndex: q.questionIndex, answers, evidence: decision.evidence };
    });
}
async function waitForTakeover(pending, page, log, { observe = async () => false, inspect = async () => false, interval = 1000 } = {}) {
    fs.writeFileSync(pending.replyPath + '.takeover-ready', 'ready');
    let passed = false, lastResume = '';
    const resumePath = pending.replyPath + '.resume.json';
    for (;;) {
        if (page.isClosed()) throw Error('接管期间页面已关闭；保留提交保护，不自动重交');
        try { passed = passed || await observe(); } catch {}
        if (fs.existsSync(resumePath)) {
            const text = fs.readFileSync(resumePath, 'utf8');
            if (text !== lastResume) {
                lastResume = text;
                let resume; try { resume = JSON.parse(text); } catch {}
                if (resume?.requestId === pending.request.requestId && resume.action === 'continue') {
                    let ok = passed;
                    try { ok = ok || await inspect(); } catch (error) { log('只读核对失败：' + error.message); }
                    fs.writeFileSync(resumePath + '.result.json', JSON.stringify({ ok, token: resume.token }));
                    if (ok) { log('✅ 已核对人工提交结果，恢复后续自动学习'); return { status: 'submitted', reason: '人工接管后平台确认通过' }; }
                    log('🔔 暂未获得平台通过证明，请核对网页；保持接管，脚本不会提交或重交。');
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}
async function waitForReply(pending, page, log, interval = 3000) {
    let lastError = '';
    log(`🔔 正在等待用户确认，不提交。题目：${pending.notePath}；答复：${pending.replyPath}`);
    for (;;) {
        if (page.isClosed()) throw Error('等待确认时浏览器页面已关闭');
        if (fs.existsSync(pending.replyPath)) {
            try { return validateReply(pending.request, JSON.parse(fs.readFileSync(pending.replyPath, 'utf8').replace(/^\uFEFF/, ''))); }
            catch (error) { if (error.message !== lastError) { log(`⚠️ 答复暂不可用，继续等待：${error.message}`); lastError = error.message; } }
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}
module.exports = { publishRequest, validateReply, waitForReply, waitForTakeover, desktopNotice };
