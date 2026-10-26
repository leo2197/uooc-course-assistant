const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
function gradeValue(data) {
    const value = data?.data?.task?.score;
    return value !== undefined && /^\d+(?:\.\d+)?$/.test(String(value)) && Number(value) <= 100 ? Number(value) : null;
}
async function inspectGrade(context, courseId, examId, outputDir) {
    if (!/^\d+$/.test(courseId) || !/^\d+$/.test(examId)) throw Error('Invalid exam identity');
    const page = await context.newPage();
    let grade = null;
    const reads = [];
    page.on('response', response => {
        if (new URL(response.url()).pathname !== '/exam/view') return;
        reads.push(response.json().then(data => { const value=gradeValue(data); if(value!==null) grade=value; }).catch(()=>{}));
    });
    try {
        await page.goto(`http://www.uooc.net.cn/exam/${examId}`,{waitUntil:'domcontentloaded',timeout:40000});
        await page.waitForTimeout(3000);
        await Promise.allSettled(reads);
        if (grade === null) return null;
        fs.mkdirSync(outputDir,{recursive:true});
        const prefix=path.join(outputDir,`exam-${courseId}-${examId}`);
        fs.writeFileSync(prefix+'.txt',await page.locator('body').innerText(),'utf8');
        fs.writeFileSync(prefix+'-state.json',JSON.stringify([{endpoint:'/exam/view',status:{data:{task:{score:String(grade)}}},capturedAt:new Date().toISOString()}],null,2));
        return grade;
    } finally { await page.close(); }
}
async function watchGrades(context, pid, courseIds, outputDir) {
    if (!Number.isInteger(pid) || pid<=0) throw Error('Invalid learning PID');
    const retries=new Map(), finished=new Set();
    for (;;) {
        let alive=true; try { process.kill(pid,0); } catch(error) { alive=error.code==='EPERM'; }
        const names=fs.readdirSync(DATA_DIR).filter(name=>/^exam-feedback-\d+-\d+\.json$/.test(name));
        for(const name of names) {
            const [,course,exam]=name.match(/^exam-feedback-(\d+)-(\d+)\.json$/);
            if(!courseIds.includes(course) || finished.has(name) || (retries.get(name)||0)>=3) continue;
            const previous=path.join(outputDir,`exam-${course}-${exam}-state.json`);
            if(fs.existsSync(previous)) {
                try { if(JSON.parse(fs.readFileSync(previous,'utf8')).some(item=>gradeValue(item.status)!==null)) {finished.add(name);continue;} } catch{}
            }
            retries.set(name,(retries.get(name)||0)+1);
            try {
                const grade=await inspectGrade(context,course,exam,outputDir);
                if(grade!==null) {finished.add(name);console.log(`[成绩监督] 测验${exam}：${grade}分（平台实际成绩）`);}
            } catch(error) {console.log(`[成绩监督] 测验${exam}只读查询失败：${error.message}`);}
        }
        if(!alive) break;
        await new Promise(resolve=>setTimeout(resolve,15000));
    }
}
module.exports={gradeValue,inspectGrade,watchGrades};
