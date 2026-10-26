const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { publishRequest, validateReply, waitForReply, waitForTakeover } = require('../utils/human-review');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-review-'));
let notices = 0;
const questions = [{ questionIndex: 2, text: 'Output question', choices: ['D. 0','A. 3.2'], type: '单选题', blankCount: 0, why: 'uncertain' }];
(async () => {
    const pending = publishRequest(directory, '123', ['456'], questions, () => notices++);
    const repeat = publishRequest(directory, '123', ['456'], [{ ...questions[0], why: 'new analysis' }], () => notices++);
    assert.equal(repeat.request.requestId, pending.request.requestId); assert.equal(notices, 1);
    const reply = { requestId: pending.request.requestId, decisions: [{ questionIndex: 2, answerTexts: ['0'], evidence: 'Explicit user confirmation' }] };
    assert.deepEqual(validateReply(pending.request, reply)[0].answers, ['D']);
    assert.throws(() => validateReply(pending.request, { ...reply, requestId: 'different' }));
    assert.throws(() => validateReply(pending.request, { ...reply, decisions: [{ ...reply.decisions[0], answerTexts: ['D'] }] }));
    assert.throws(() => validateReply(pending.request, { ...reply, decisions: [{ ...reply.decisions[0], answerTexts: ['0','3.2'] }] }));
    assert.throws(() => validateReply(pending.request, { ...reply, decisions: [] }));
    // An incomplete reply cannot release the wait; a later valid reply can.
    fs.writeFileSync(pending.replyPath, JSON.stringify({ requestId: 'wrong', decisions: [] }));
    setTimeout(() => fs.writeFileSync(pending.replyPath, JSON.stringify(reply)), 30);
    const decisions = await waitForReply(pending, { isClosed: () => false }, () => {}, 5);
    assert.deepEqual(decisions[0].answers, ['D']);
    assert.equal(validateReply(pending.request,{requestId:pending.request.requestId,mode:'takeover'}).takeover,true);
    let checks=0;
    const resumePath=pending.replyPath+'.resume.json';
    fs.writeFileSync(resumePath,JSON.stringify({requestId:pending.request.requestId,action:'continue',token:'first'}));
    const result=await waitForTakeover(pending,{isClosed:()=>false},()=>{}, {interval:5,inspect:async()=>{
        checks++;
        if(checks===1){setTimeout(()=>fs.writeFileSync(resumePath,JSON.stringify({requestId:pending.request.requestId,action:'continue',token:'second'})),15);return false;}
        return true;
    }});
    assert.equal(checks,2);assert.equal(result.status,'submitted');
    console.log('PASS one notice per request; exact answer-content matching; malformed/incomplete reply waits; valid reply releases');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
    fs.rmdirSync(directory);
});
