const assert=require('node:assert/strict'),http=require('node:http');
const {chromium}=require('playwright');
const guard=require('../utils/navigation-guard');
const html=`<a id="away" href="/away">其他页面</a><a id="next" class="oneline" href="/learn#2">下一节</a>
<video></video><div class="ti">单选题 fixture question<label class="ti-a">A. first<input type="radio" value="a"></label><label class="ti-a">B. second<input type="radio" value="b"></label></div>
<script>const v=document.querySelector('video');Object.defineProperties(v,{currentSrc:{get:()=>'/fixture.mp4'},duration:{get:()=>100},currentTime:{value:0,writable:true}})</script>`;
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url.startsWith('/learn')?html:'<h1>其他页面</h1>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();await page.goto(base+'/learn');
  const messages=[];await guard.install(page,'123',message=>messages.push(message),{allowedURL:url=>url.startsWith(base+'/learn')});
  await page.locator('#away').click();assert.equal(page.url(),base+'/learn');
  await page.evaluate(()=>document.querySelector('#next').click());await page.waitForURL(base+'/learn#2');
  await new Promise(r=>setTimeout(r,200));assert.equal(guard.revision(page),0,'Script navigation must not trigger recovery');
  await page.evaluate(()=>document.querySelector('video').currentTime=25);await new Promise(r=>setTimeout(r,1100));
  await page.goto(base+'/away').catch(()=>{});await page.waitForURL(base+'/learn#2');await guard.ensure(page);
  assert.equal(guard.revision(page),1);assert.equal(await page.locator('video').evaluate(v=>v.currentTime),25);
  await guard.pause(page);await page.locator('#away').click();await page.waitForURL(base+'/away');
  await new Promise(r=>setTimeout(r,1100));assert.equal(page.url(),base+'/away','Manual takeover must keep control');
  await guard.resume(page);assert.equal(page.url(),base+'/learn#2');
  // A model result from before page recovery must never fill or submit the new form.
  const mod=require('../utils/module');let interrupted=false;
  mod.getEnsembleAnswers=async()=>{if(!interrupted){interrupted=true;await page.goto(base+'/away').catch(()=>{});await guard.ensure(page);}return {answers:['A'],confident:true,agreement:1,total:1};};
  const {answerOneQuestion}=require('../utils/quiz');
  await assert.rejects(()=>answerOneQuestion(page.locator('.ti'),page,()=>{},require('node:path').join(require('os').tmpdir(),'uooc-navigation-fixture.png')),/旧模型答案已丢弃/);
  assert.equal(await page.locator('input:checked').count(),0);
  assert.ok(messages.some(t=>t.includes('已拦住误点')));guard.dispose(page);
  console.log('PASS trusted misclick blocked; script route allowed; stray navigation and watched position recovered; takeover respected; stale quiz answer rejected');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
