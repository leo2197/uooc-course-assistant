const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {chromium}=require('playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uooc-supervised-'));
require('../utils/config').DATA_DIR=dir;
const review=require('../utils/human-review'), publish=review.publishRequest;
review.publishRequest=(...args)=>publish(...args,()=>{});
const mod=require('../utils/module');mod.getEnsembleAnswers=async()=>{throw Error('Supervised mode must not call unreviewed AI');};
let reserved=false;
require('../utils/submission').reserveSubmission=()=>{reserved=true;throw Error('Offline fixture stops before submission');};
const {processQuizQuestions}=require('../utils/quiz');
(async()=>{
    process.env.UOOC_SUPERVISED='1';process.env.UOOC_HUMAN_REVIEW_DIR=dir;
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
        const page=await browser.newPage();
        await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<button onclick="window.clicked=true">提交试卷</button><h3>单选题</h3><div class="queContainer">1. fixture<label class="ti-a">A. correct<input type="radio" name="a"></label><label class="ti-a">B. wrong<input type="radio" name="a"></label></div>'}));
        await page.goto('http://www.uooc.net.cn/exam/987654321');page.waitForTimeout=async()=>{};
        const running=processQuizQuestions(page,()=>{},'987654321');
        const deadline=Date.now()+5000;let request;
        while(Date.now()<deadline){const file=fs.readdirSync(dir).find(n=>n.endsWith('.request.json'));if(file){request=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));break;}await new Promise(r=>setTimeout(r,10));}
        assert.ok(request);assert.equal(reserved,false);assert.equal(await page.locator('input:checked').count(),0);
        fs.writeFileSync(path.join(dir,request.requestId+'.reply.json'),JSON.stringify({requestId:request.requestId,decisions:[{questionIndex:1,answerTexts:['correct'],evidence:'Independent fixture verification'}]}));
        const result=await running;
        assert.equal(result.status,'blocked');assert.equal(reserved,true);
        assert.equal(await page.locator('input:checked').count(),1);assert.equal(await page.evaluate(()=>!!window.clicked),false);
        console.log('PASS real browser supervised paper waits before answering, resumes only validated reply, never submits in offline test');
    }finally{await browser.close();delete process.env.UOOC_SUPERVISED;delete process.env.UOOC_HUMAN_REVIEW_DIR;}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);});
