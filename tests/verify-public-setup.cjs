const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {endpoint,key,detect}=require('../provider.cjs'),{pick}=require('../assistant.cjs');
(async()=>{
 assert.equal(endpoint('https://open.bigmodel.cn/apikey/platform'),'https://open.bigmodel.cn/api/paas/v4/chat/completions');
 assert.equal(endpoint('https://api.example.invalid/v1/'),'https://api.example.invalid/v1/chat/completions');
 assert.throws(()=>endpoint('https://user:password@example.invalid/v1'));
 assert.throws(()=>key('中文'));assert.throws(()=>key('\x16'));assert.equal(key(' test-key '),'test-key');
 assert.deepEqual(pick('1 2 1'),[1,2]);assert.throws(()=>pick('0'));assert.throws(()=>pick('a'));
 const seen=[];const detected=await detect({url:'https://api.example.invalid/v1',key:'test-key'},{fetchFn:async(url,options)=>{seen.push(url);if(!options.body)return {ok:true,json:async()=>({data:[{id:'embedding'},{id:'glm-fixture-flash'}]})};return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})};}});
 assert.equal(detected.model,'glm-fixture-flash');assert.equal(seen.length,2);
 await assert.rejects(()=>detect({url:'https://api.example.invalid/v1',key:'test-key',model:'fixture'},{fetchFn:async()=>({ok:false,status:401})}),/401/);
 if(process.platform==='win32'){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uooc-private-')),file=path.join(dir,'private.dpapi');try{require('../private.cjs').write(file,{key:'fake-secret'});assert(!fs.readFileSync(file,'utf8').includes('fake-secret'));assert.deepEqual(require('../private.cjs').read(file),{key:'fake-secret'});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
 const {select}=require('../course-picker.cjs');let created=0,closed=0;const context={newPage:async()=>{created++;return {goto:async()=>{},locator:()=>({first:()=>({innerText:async()=>'fixture'})}),close:async()=>{closed++;}};}};
 assert.deepEqual(await select(context,['https://example.invalid/1','https://example.invalid/2'],{question:async()=>'2',log:()=>{}}),['https://example.invalid/2']);assert.equal(created,closed);
 console.log('PASS public setup: provider detection/errors, key validation, encrypted roundtrip, numbered course selection');
})().catch(e=>{console.error(e);process.exitCode=1;});
