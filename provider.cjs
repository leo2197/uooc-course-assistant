const fs=require('fs'),path=require('path');
const file=path.join(__dirname,'config/provider.dpapi');
function endpoint(value){const u=new URL(String(value).trim());if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('API地址需要HTTPS，本机服务可以HTTP');if(u.username||u.password||u.search||u.hash)throw Error('API地址不能含密码、查询参数或片段');if(u.hostname==='open.bigmodel.cn'&&(u.pathname==='/'||u.pathname.startsWith('/apikey')))u.pathname='/api/paas/v4';u.pathname=u.pathname.replace(/\/$/,'');if(!u.pathname.endsWith('/chat/completions'))u.pathname+='/chat/completions';return u.href;}
function key(value){if(typeof value!=='string'||!/^[\x21-\x7e]+$/.test(value.trim()))throw Error('Key为空或含空格、中文、控制字符，请重新复制完整API Key');return value.trim();}
function load(source=file){return fs.existsSync(source)?require('./private.cjs').read(source):null;}
async function request(url,apiKey,body,fetchFn=fetch){const r=await fetchFn(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key(apiKey),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('模型服务HTTP '+r.status);return r.json();}
async function detect(input,{fetchFn=fetch}={}){
 const url=endpoint(input.url),apiKey=key(input.key);let models=[];
 if(input.model)models=[input.model];else{const catalog=await request(url.replace(/\/chat\/completions$/,'/models'),apiKey,null,fetchFn);models=(catalog.data||[]).map(x=>x.id).filter(x=>typeof x==='string'&&!/embed|rerank|tts|asr|image-generation/i.test(x));models.sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));}
 if(!models.length)throw Error('没有读到模型，请重新设置并手动填写模型ID');
 let chosen,last;
 for(const model of models.slice(0,6))try{const result=await request(url,apiKey,{model,messages:[{role:'user',content:'Reply with OK.'}],max_tokens:64},fetchFn);if(!result.choices?.[0]?.message?.content)throw Error('模型没有返回内容');chosen=model;break;}catch(e){last=e;}
 if(!chosen)throw last||Error('没有可用模型');
 const judge=input.judge||chosen;
 if(judge!==chosen){const r=await request(url,apiKey,{model:judge,messages:[{role:'user',content:'Reply with OK.'}],max_tokens:64},fetchFn);if(!r.choices?.[0]?.message?.content)throw Error('裁决模型没有返回内容');}
 return {url,key:apiKey,model:chosen,judge};
}
function rank(id){return /^glm.*flash/i.test(id)?0:/^glm/i.test(id)?1:/vision|vl|gpt/i.test(id)?2:3;}
async function configure(pending){const input=load(pending);if(!input)throw Error('没有临时配置');const detected=await detect(input);require('./private.cjs').write(file,detected);console.log('检测通过，主答：'+detected.model+'；裁决：'+detected.judge+'。Key已用当前Windows用户加密。');}
if(require.main===module)configure(process.argv[2]).catch(e=>{console.error('检测失败，旧设置保留：'+e.message);process.exitCode=1;});
module.exports={file,endpoint,key,load,detect};
