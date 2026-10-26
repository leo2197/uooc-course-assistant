const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {chromium}=require('playwright'),{login}=require('../web-login.cjs');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uooc-web-session-'));let context;
try{
 context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true});assert(context.browser(),'Persistent context must expose browser close/disconnect lifecycle');
 await context.route('**/*',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:'<button id="loginBtn" onclick="localStorage.setItem(\'logged\',\'yes\');this.outerHTML=\'<a id=top_avatar>fixture</a>\'">本人登录示意</button><script>if(localStorage.logged)document.querySelector(\'button\').outerHTML=\'<a id=top_avatar>fixture</a>\'</script>'}));
 const logs=[];await login(context.pages()[0],{log:x=>logs.push(x)});assert(logs.some(x=>x.includes('网页登录已完成')));await context.close();
 context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true});await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<script>if(localStorage.logged)document.write(\'<a id=top_avatar>fixture</a>\')</script>'}));
 const restored=[];await login(context.pages()[0],{log:x=>restored.push(x)});assert(restored.some(x=>x.includes('复用')));
 console.log('PASS isolated Edge: initial web login recognized, persistent session reused, no real website/network');
}finally{await context?.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
