const assert = require('node:assert/strict');
const root = require('node:path').join(__dirname, '../utils/');
const config = require(root + 'config');
config.VERIFY_SECOND_PASS = true;
config.VERIFY_MAX_ROUNDS = 3;
let queue, calls=[];
const mod = require(root + 'module');
mod.getEnsembleAnswers = async (_image,_type,_log,options) => { calls.push(options); return queue.shift(); };
// This test owns model voting only; native DOM writes have real-browser coverage.
require(root + 'choice-actions').clickChoices = async () => {};
const { answerOneQuestion } = require(root + 'quiz');
const option = { count: async () => 1, click: async () => {} };
const q = {
  scrollIntoViewIfNeeded: async () => {}, evaluate: async () => '单选题',
  innerText: async () => 'isolated regression fixture', screenshot: async () => {},
  locator: () => ({ filter: () => ({ first: () => option }),
    allTextContents: async () => ['A. first', 'B. second'] })
};
const page = { waitForTimeout: async () => {}, frames: () => [], evaluate: async () => '' };
const vote = (a, confident = true) => ({ answers: [a], confident, agreement: 1, total: 1 });
(async () => {
  queue = [vote('A'), vote('A')];
  assert.equal((await answerOneQuestion(q, page, () => {}, '')).confident, true);
  queue = [vote('A'), vote('A', false)];
  assert.equal((await answerOneQuestion(q, page, () => {}, '')).confident, false);
  queue = [vote('A'), vote('B'), vote('A')];
  const r = await answerOneQuestion(q, page, () => {}, '');
  assert.deepEqual([...r.answers], ['A']);
  assert.equal(r.confident, false);
  queue = [vote('A'), vote('B'), vote('A'), vote('A')];
  assert.equal((await answerOneQuestion(q, page, () => {}, '')).confident, true);
  queue = [vote('A'), vote('B'), vote('A'), vote('B')];calls=[];
  const final=await answerOneQuestion(q, page, () => {}, '');
  assert.equal(final.confident,true);assert.deepEqual([...final.answers],['B']);
  assert.deepEqual(calls.at(-1).models,[config.JUDGE_MODEL]);assert.equal(calls.at(-1).useJudge,false);
  queue = [vote('A'), vote('B'), vote('A'), vote('C')];
  assert.equal((await answerOneQuestion(q, page, () => {}, '')).confident,false);
  console.log('PASS unanimous; final judge overrides disagreement; failed/invalid final verdict retains protection');
})().catch(e => { console.error(e); process.exitCode = 1; });
