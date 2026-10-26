const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { DATA_DIR } = require('./utils/config');
const { validateReply } = require('./utils/human-review');
async function runReview() {
    const directory = process.env.UOOC_HUMAN_REVIEW_DIR || path.join(DATA_DIR, 'human-review');
    const requests = fs.existsSync(directory) ? fs.readdirSync(directory)
        .filter(name => name.endsWith('.request.json') && !fs.existsSync(path.join(directory, name.replace('.request.json', '.reply.json'))))
        .sort((a,b) => fs.statSync(path.join(directory,b)).mtimeMs - fs.statSync(path.join(directory,a)).mtimeMs) : [];
    if (!requests.length) { console.log('当前没有待答复请求。运行脚本遇到问题时会弹出提醒。'); return; }
    const request = JSON.parse(fs.readFileSync(path.join(directory, requests[0]), 'utf8'));
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    const replyPath = path.join(directory, `${request.requestId}.reply.json`);
    const external = new AbortController();
    const ask = text => terminal.question(text, { signal: external.signal });
    const watcher = setInterval(() => {
        if (!fs.existsSync(replyPath)) return;
        try { validateReply(request, JSON.parse(fs.readFileSync(replyPath, 'utf8').replace(/^\uFEFF/, ''))); external.abort(); }
        catch { /* Incomplete or invalid external replies must not close the prompt. */ }
    }, 200);
    const decisions = [];
    async function takeOver() {
        fs.writeFileSync(replyPath, JSON.stringify({ requestId: request.requestId, mode: 'takeover' }), { flag: 'wx' });
        clearInterval(watcher);
        console.log('正在切换接管模式，等待脚本交出控制权…');
        for (let tick = 0; !fs.existsSync(replyPath + '.takeover-ready'); tick++) {
            if (tick >= 150) throw Error('接管尚未确认，请保留网页，勿重复提交');
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        console.log('已交出控制权。请在浏览器中完成并提交测验，脚本不会替你点击提交。');
        for (;;) {
            if ((await ask('网页提交后输入“继续”恢复自动学习：')).trim() !== '继续') continue;
            const resumePath = replyPath + '.resume.json', token = String(Date.now());
            fs.writeFileSync(resumePath, JSON.stringify({ requestId: request.requestId, action: 'continue', token }));
            let result;
            for (let tick = 0; tick < 60; tick++) {
                try { result = JSON.parse(fs.readFileSync(resumePath + '.result.json', 'utf8')); } catch {}
                if (result?.token === token) break;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            if (result?.token === token && result.ok) { console.log('平台结果核对成功，恢复自动学习。'); return; }
            console.log('尚未确认通过，请保留网页“测验通过”提示后重试。不会重新提交。');
        }
    }
    try {
        console.log('可填写答案后输入“确认”，也可在选项提示处输入“接管”转到网页手动作答。Ctrl+C退出不放行。');
        for (const q of request.questions) {
            console.log(`\n第${q.questionIndex}题\n${q.text}\n待确认原因：${q.why}`);
            let decision;
            for (;;) {
                if (q.choices.length) {
                    const options = q.choices.map(c => c.trim().match(/^([A-H])[.、．]\s*([\s\S]*)$/));
                    const input = (await ask('输入本题选项字母，多选用逗号分隔：')).trim();
                    if (input === '接管') { await takeOver(); return; }
                    const letters = input.toUpperCase().split(/[\s,，]+/).filter(Boolean);
                    if (!letters.length || new Set(letters).size !== letters.length || letters.some(l => !options.some(o => o && o[1] === l))
                        || (/单选|判断/.test(q.type) && letters.length !== 1)) { console.log('选项或答案数量不正确，请重新输入。'); continue; }
                    decision = { questionIndex: q.questionIndex, answerTexts: letters.map(l => options.find(o => o[1] === l)[2].trim()) };
                } else {
                    const answers = [];
                    for (let i=0; i<q.blankCount; i++) {
                        const input = await ask(`第${i+1}空（输入“接管”可网页作答）：`);
                        if (input.trim() === '接管') { await takeOver(); return; }
                        answers.push(input);
                    }
                    if (!answers.length || answers.some(a => !a.trim())) { console.log('填空答案不能留空。'); continue; }
                    decision = { questionIndex:q.questionIndex, answers };
                }
                decision.evidence = (await ask('确认依据（例如“按课程要求”，不可留空）：')).trim();
                if (decision.evidence) break;
                console.log('请填写确认依据。');
            }
            decisions.push(decision);
        }
        const reply = { requestId: request.requestId, decisions };
        validateReply(request, reply);
        console.log('\n本次确认：' + decisions.map(d => `第${d.questionIndex}题：${(d.answerTexts || d.answers).join('；')}`).join('\n'));
        if ((await ask('输入“确认”交给脚本继续，其余输入取消：')).trim() !== '确认') { console.log('已取消，脚本继续等待。'); return; }
        const temporary = replyPath + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(reply, null, 2), { flag:'wx' });
        fs.renameSync(temporary, replyPath);
        console.log('已保存答复。运行中的脚本会再次核对题目，再继续。');
    } catch (error) {
        if (!external.signal.aborted) throw error;
        console.log('\n已收到有效的外部核验答复，关闭输入等待并恢复进度显示。');
    } finally { clearInterval(watcher); terminal.close(); }
}
if (require.main === module) runReview().catch(error => { console.error('答复失败：', error.message); process.exitCode=1; });
module.exports = { runReview };
