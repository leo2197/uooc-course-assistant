const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reserveSubmission } = require('../utils/submission');
let clicks = 0;
const browser = require('../utils/browser');
browser.handleCaptcha = async () => true;
browser.humanClick = async () => { clicks++; };
const { confirmQuizSubmission } = require('../utils/quiz');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-once-'));
(async () => {
    reserveSubmission(directory, '123', ['456', '456']);
    // A reload/restart and a transport error both retain the same durable reservation.
    assert.throws(() => reserveSubmission(directory, '123', ['456']), /EEXIST/);
    assert.throws(() => reserveSubmission(directory, '123', ['456', '789']), /无法唯一识别/);
    const button = {click:async()=>{clicks++;}};
    const locate = async selector => selector.includes('测验通过') ? null : button;
    assert.equal(await confirmQuizSubmission({ waitForTimeout: async () => {} }, () => {}, locate), false);
    assert.equal(clicks, 1);
    let ticks = 0;
    const delayed = async selector => selector.includes('测验通过') ? (ticks >= 4 ? {} : null) : button;
    assert.equal(await confirmQuizSubmission({ waitForTimeout: async () => ticks++ }, () => {}, delayed), true);
    assert.equal(clicks, 2);
    assert.equal(await confirmQuizSubmission({ waitForTimeout: async () => {} }, () => {}, async () => null), false);
    assert.equal(clicks, 2);
    const failed = {click:async()=>{clicks++;throw Error('intercepted');}};
    assert.equal(await confirmQuizSubmission({waitForTimeout:async()=>{}},()=>{},async selector=>selector.includes('测验通过')?null:failed),false);
    assert.equal(clicks,3);
    reserveSubmission(directory, '123', ['789']);
    console.log('PASS durable per-exam reservation blocks restart retry; ambiguous confirmation clicks only once');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    // Remove only the exact files created in this test, without recursive deletion.
    for (const id of ['456', '789']) fs.unlinkSync(path.join(directory, 'submission-attempts', `123-${id}.json`));
    fs.rmdirSync(path.join(directory, 'submission-attempts')); fs.rmdirSync(directory);
});
