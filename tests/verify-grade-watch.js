const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {gradeValue,inspectGrade}=require('../utils/grade-watch');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uooc-grade-'));
(async()=>{
    assert.equal(gradeValue({data:{task:{score:'100.00'}}}),100);
    assert.equal(gradeValue({data:{task:{pass_score:'100'}}}),null);
    assert.equal(gradeValue({data:{task:{score:'pending'}}}),null);
    let callback,closed=false;
    const context={newPage:async()=>({on:(_,cb)=>callback=cb,goto:async()=>callback({url:()=> 'http://www.uooc.net.cn/exam/view',json:async()=>({data:{task:{score:'80.00'}}})}),
        waitForTimeout:async()=>{},locator:()=>({innerText:async()=> '得分：80.00分'}),close:async()=>closed=true})};
    assert.equal(await inspectGrade(context,'123','456',dir),80);
    assert.equal(closed,true);
    assert.ok(fs.readFileSync(path.join(dir,'exam-123-456.txt'),'utf8').includes('80.00'));
    console.log('PASS grade observer records actual score, excludes pass thresholds and pending values, closes read-only page');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);});
