const fs = require('fs');
const path = require('path');
const { desktopNotice, validateReply } = require('./utils/human-review');
function pendingReviews(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(name => name.endsWith('.request.json')).filter(name => {
        try {
            const request = JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
            const reply = JSON.parse(fs.readFileSync(path.join(directory,name.replace('.request.json','.reply.json')),'utf8'));
            validateReply(request,reply); return false;
        } catch { return true; }
    }).map(name => path.join(directory,name));
}
function assess({ alive, idleMs, pending }) {
    if (!alive) return { state:'stopped', message:'学习脚本已退出。请核对运行结果和平台成绩，退出不等于全部完成。' };
    if (pending.length) return { state:'needs_review', message:`有${pending.length}批题目等待确认。请查看待确认题目并答复。` };
    if (idleMs >= 15*60*1000) return { state:'stalled', message:'学习脚本仍在，但超过15分钟没有日志更新，请检查网络或浏览器。' };
    return { state:'running', message:'学习脚本运行中' };
}
function scoresIn(directory) {
    if (!directory || !fs.existsSync(directory)) return [];
    const scores = [];
    for (const name of fs.readdirSync(directory)) {
        const match = name.match(/^exam-(\d+)-(\d+)-state\.json$/);
        if (!match) continue;
        try {
            const entries = JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
            for (const entry of entries) {
                const score = entry.status?.data?.task?.score;
                if (score !== undefined && /^\d+(?:\.\d+)?$/.test(String(score)) && Number(score) <= 100) scores.push({ courseId:match[1], examId:match[2], score:Number(score) });
            }
        } catch { }
    }
    return scores;
}
function run(options) {
    if (!Number.isInteger(options.pid) || options.pid <= 0) throw Error('需要有效的学习进程PID');
    const alerted = new Set();
    try { for (const key of JSON.parse(fs.readFileSync(options.out,'utf8')).alerted || []) alerted.add(key); } catch { }
    let timer;
    function tick() {
        let alive = true;
        try { process.kill(options.pid,0); } catch (error) { alive = error.code === 'EPERM'; }
        const pending = pendingReviews(options.review);
        let idleMs = 0;
        try { idleMs = Math.max(0,Date.now()-fs.statSync(options.log).mtimeMs); } catch { idleMs=Infinity; }
        const status = assess({ alive,idleMs,pending });
        if (status.state === 'running') {
            for (const key of alerted) if (key.startsWith(`${options.pid}:`)) alerted.delete(key);
        }
        const grades = (options.gradeDirs || []).flatMap(scoresIn);
        const notices = [];
        if (status.state !== 'running') notices.push({ key:`${options.pid}:${status.state}:${pending.join('|')}`, message:status.message });
        for (const grade of grades.filter(item=>item.score<100)) notices.push({ key:`score:${grade.examId}:${grade.score}`, message:`测验${grade.examId}平台成绩${grade.score}分，未达到满分。不要重复提交，请核查。` });
        for (const notice of notices) {
            if (alerted.has(notice.key)) continue;
            alerted.add(notice.key);
            if (!options.silent) desktopNotice(notice.message);
        }
        fs.mkdirSync(path.dirname(options.out),{recursive:true});
        fs.writeFileSync(options.out,JSON.stringify({ checkedAt:new Date().toISOString(), monitorPid:process.pid,
            learningPid:options.pid, ...status, pending, grades, alerted:[...alerted] },null,2));
        if (!alive && timer) clearInterval(timer);
        return alive;
    }
    const alive = tick();
    if (alive && !options.once) timer = setInterval(tick,60000);
}
if (require.main === module) {
    const args=process.argv.slice(2), value = name => args[args.indexOf(name)+1];
    try { run({ pid:Number(value('--pid')), log:value('--log'), out:value('--out'), review:value('--review'),
        gradeDirs:args.flatMap((arg,i)=>arg==='--grade-dir'?[args[i+1]]:[]), once:args.includes('--once'),silent:args.includes('--silent') }); }
    catch(error) { console.error('监督启动失败：'+error.message);process.exitCode=1; }
}
module.exports = { assess, pendingReviews, scoresIn, run };
