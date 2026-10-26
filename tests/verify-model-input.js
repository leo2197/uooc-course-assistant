const assert = require('node:assert/strict');
const root = require('node:path').join(__dirname, '../utils/');
const budget = require(root + 'budget');
budget.consume = () => true;
budget.summary = () => 'isolated test';
const captured = [];
let answers, decision;
global.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    captured.push(body);
    return { ok: true, json: async () => ({ choices: [{ message: {
        content: JSON.stringify({ answers: [answers[body.model]], ...decision })
    } }] }) };
};
const mod = require(root + 'module');
const image = __filename;
const questionText = 'int x=011; printf("%d",++x); A.9 B.10';
const context = 'original lecture';
(async () => {
    answers = { one: 'A', two: 'B', judge: 'B' };
    const disputed = await mod.getEnsembleAnswers(image, '单选题', () => {}, {
        models: ['one', 'two'], judgeModel: 'judge', minAgree: 2, questionText, context
    });
    assert.equal(disputed.confident, false);
    assert.equal(captured.length, 3);
    for (const body of captured) {
        assert.ok(body.messages[0].content[0].text.includes(questionText));
        assert.ok(body.messages[0].content[0].text.includes(context));
    }
    captured.length = 0;
    answers = { one: 'A', two: 'A', three: 'B' };
    const majority = await mod.getEnsembleAnswers(image, '单选题', () => {}, {
        models: ['one', 'two', 'three'], minAgree: 2, useJudge: false, questionText
    });
    assert.equal(captured.length, 3);
    assert.equal(majority.confident, false);
    assert.deepEqual(mod.normalizeAnswers(['A', 'incorrect prose'], false), ['A']);
    answers={judge:'B'};
    const finalOptions={models:['judge'],useJudge:false,minAgree:1,decisionRequired:true,questionText};
    decision={decision:'review',reason:'题意仍不确定'};
    assert.equal((await mod.getEnsembleAnswers(image,'单选题',()=>{},finalOptions)).confident,false);
    decision=undefined;
    assert.equal((await mod.getEnsembleAnswers(image,'单选题',()=>{},finalOptions)).confident,false);
    decision={decision:'submit',reason:'已核算循环结果'};
    assert.equal((await mod.getEnsembleAnswers(image,'单选题',()=>{},finalOptions)).confident,true);
    answers={'glm-5.3-flash':'B'};
    await mod.getEnsembleAnswers(image,'单选题',()=>{},{...finalOptions,models:['glm-5.3-flash'],reasoningEffort:'medium'});
    const modern=captured.at(-1);
    assert.equal(modern.reasoning_effort,'high');assert.equal(modern.thinking.type,'enabled');
    assert.equal(modern.temperature,1);assert.equal(modern.top_p,0.95);
    console.log('PASS exact DOM and context reach all models/judge; all votes awaited; majority remains uncertain');
})().catch(e => { console.error(e); process.exitCode = 1; });
