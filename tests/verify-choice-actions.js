const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {clickChoices,verifyChoices}=require('../utils/choice-actions');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{const page=await browser.newPage();
 async function fixture({multiple=false,duplicate=false,sync=true}={}){
  await page.setContent(`<div id="q"><label class="ti-a">A. Paragraph mentioning B.<p>Second line</p><input style="display:none" type="${multiple?'checkbox':'radio'}" name="q" value="0"></label><label class="ti-a">B. Correct<input style="display:none" type="${multiple?'checkbox':'radio'}" name="q" value="${duplicate?'0':'key-b'}"></label></div>`);
  await page.evaluate(({sync})=>{window.question={options:[{key:'key-b'},{key:0}],student_answer:[],checked:false};window.angular={element:()=>({scope:()=>({question:window.question})})};if(sync)for(const input of document.querySelectorAll('input'))input.onchange=()=>{question.student_answer=[...document.querySelectorAll('input:checked')].map(i=>i.value);question.checked=true;};},{sync});return page.locator('#q');
 }
 let q=await fixture();await clickChoices(q,['B']);assert.equal(await page.locator('input:checked').getAttribute('value'),'key-b');
 await verifyChoices(q,['B']);await page.evaluate(()=>question.student_answer=['0']);await assert.rejects(()=>verifyChoices(q,['B']),/模型与待提交答案不一致/);
 q=await fixture({multiple:true});await clickChoices(q,['A','B']);assert.equal(await page.locator('input:checked').count(),2);await clickChoices(q,['B']);assert.equal(await page.locator('input:checked').count(),1);
 q=await fixture({duplicate:true});await assert.rejects(()=>clickChoices(q,['B']),/ID缺失或重复/);assert.equal(await page.locator('input:checked').count(),0);
 q=await fixture({sync:false});await assert.rejects(()=>clickChoices(q,['B']),/尚未同步/);
 q=await fixture();await page.locator('input').last().evaluate(el=>el.value='wrong');await assert.rejects(()=>clickChoices(q,['B']),/模型不一致/);
 q=await fixture();await page.locator('.ti-a').last().evaluate(el=>el.childNodes[0].textContent='A. duplicate label');await assert.rejects(()=>clickChoices(q,['A']),/编号缺失或重复/);
 console.log('PASS rich-text labels, hidden native controls, zero IDs, shuffled model IDs, multi-select correction, duplicate/missing IDs and stale model protection');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
