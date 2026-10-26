const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { assess, pendingReviews, scoresIn, run } = require('../monitor');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'uooc-monitor-'));
try {
    assert.equal(assess({alive:true,idleMs:0,pending:[]}).state,'running');
    assert.equal(assess({alive:false,idleMs:0,pending:['pending']}).state,'stopped');
    assert.equal(assess({alive:true,idleMs:0,pending:['pending']}).state,'needs_review');
    assert.equal(assess({alive:true,idleMs:16*60*1000,pending:[]}).state,'stalled');
    const request={requestId:'monitor-test',questions:[{questionIndex:1,choices:['A. correct'],type:'单选题'}]};
    fs.writeFileSync(path.join(dir,'test.request.json'),JSON.stringify(request));
    fs.writeFileSync(path.join(dir,'test.reply.json'),'invalid reply');
    assert.equal(pendingReviews(dir).length,1);
    fs.writeFileSync(path.join(dir,'test.reply.json'),JSON.stringify({requestId:'monitor-test',decisions:[{questionIndex:1,answerTexts:['correct'],evidence:'test'}]}));
    assert.equal(pendingReviews(dir).length,0);
    fs.writeFileSync(path.join(dir,'exam-123-456-state.json'),JSON.stringify([{status:{data:{task:{score:'100.00'}}}}]));
    assert.deepEqual(scoresIn(dir),[{courseId:'123',examId:'456',score:100}]);
    const log=path.join(dir,'run.log'), out=path.join(dir,'state.json');fs.writeFileSync(log,'running');
    run({pid:process.pid,log,out,review:dir,gradeDirs:[dir],once:true,silent:true});
    assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).state,'running');
    console.log('PASS monitor detects stopped/stalled/pending states, rejects malformed replies, records actual grade and live process');
} finally { for(const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir); }
