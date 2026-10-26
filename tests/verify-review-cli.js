const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-cli-'));
const request = { requestId:'cli-check', courseId:'123', examId:'456', questions:[
    { questionIndex:1, text:'Question', choices:['A. wrong','D. correct'], type:'单选题', blankCount:0, why:'Review' }
] };
async function exercise(confirm) {
    const child = spawn(process.execPath, [path.join(__dirname,'../review.js')], {
        env:{ ...process.env, UOOC_HUMAN_REVIEW_DIR:directory }, stdio:['pipe','pipe','pipe'] });
    const responses = [['输入本题选项字母，多选用逗号分隔：','D'], ['确认依据（例如“按课程要求”，不可留空）：','Test explicit confirmation'],
        ['输入“确认”交给脚本继续，其余输入取消：',confirm]];
    let buffer = '', errors = '';
    child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        if (responses.length && buffer.includes(responses[0][0])) { const [,answer] = responses.shift(); buffer=''; child.stdin.write(answer+'\n'); }
    });
    child.stderr.on('data', chunk => errors += chunk.toString());
    await new Promise((resolve,reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(Error('CLI timeout')); },5000);
        child.on('error',error => { clearTimeout(timeout); reject(error); });
        child.on('exit',code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(errors)); });
    });
}
(async () => {
    fs.writeFileSync(path.join(directory,'cli-check.request.json'),JSON.stringify(request));
    await exercise('取消');
    assert.equal(fs.existsSync(path.join(directory,'cli-check.reply.json')),false);
    await exercise('确认');
    const reply = JSON.parse(fs.readFileSync(path.join(directory,'cli-check.reply.json'),'utf8'));
    assert.deepEqual(reply.decisions[0].answerTexts,['correct']);
    assert.equal(reply.requestId,request.requestId);
    fs.unlinkSync(path.join(directory,'cli-check.reply.json'));
    const child=spawn(process.execPath,[path.join(__dirname,'../review.js')],{env:{...process.env,UOOC_HUMAN_REVIEW_DIR:directory},stdio:['pipe','pipe','pipe']});
    let output='',written=false;
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(!written&&output.includes('输入本题选项')){written=true;fs.writeFileSync(path.join(directory,'cli-check.reply.json'),JSON.stringify(reply));}});
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('External reply did not release prompt'))},5000);child.on('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('External CLI failed'))});child.on('error',reject)});
    assert.match(output,/已收到有效的外部核验答复/);
    fs.unlinkSync(path.join(directory,'cli-check.reply.json'));
    const takeover=spawn(process.execPath,[path.join(__dirname,'../review.js')],{env:{...process.env,UOOC_HUMAN_REVIEW_DIR:directory},stdio:['pipe','pipe','pipe']});
    let takeoverOutput='',stage=0;
    takeover.stdout.on('data',chunk=>{
        takeoverOutput+=chunk.toString();
        if(stage===0&&takeoverOutput.includes('输入本题选项')){stage=1;takeover.stdin.write('接管\n');}
        if(stage===1&&takeoverOutput.includes('网页提交后输入')){stage=2;takeover.stdin.write('继续\n');}
    });
    const exit=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{takeover.kill();reject(Error('Takeover CLI timeout'))},6000);takeover.on('exit',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('Takeover CLI failed'))});});
    const review=require('../utils/human-review');
    const pending={request,replyPath:path.join(directory,'cli-check.reply.json')};
    assert.equal((await review.waitForReply(pending,{isClosed:()=>false},()=>{},5)).takeover,true);
    await review.waitForTakeover(pending,{isClosed:()=>false},()=>{},{interval:5,inspect:async()=>true});
    await exit;assert.match(takeoverOutput,/恢复自动学习/);
    console.log('PASS CLI cancel/manual confirmation; external valid reply releases pending stdin automatically');
})().catch(error => { console.error(error); process.exitCode=1; }).finally(() => {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file)); fs.rmdirSync(directory);
});
