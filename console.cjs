const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=__dirname,lock=path.join(root,'runtime.json');
if(process.argv.includes('--check')){
  for(const name of ['start.js','assistant.cjs','provider.cjs','node_modules/playwright/package.json'])if(!fs.existsSync(path.join(root,name)))throw Error('缺少文件：'+name);
  console.log('启动文件和Playwright已就绪；模型与登录在首次引导中配置');process.exit(0);
}
try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});}
catch(error){
  if(error.code!=='EEXIST')throw error;
  let stale=false;try{const old=JSON.parse(fs.readFileSync(lock,'utf8'));try{process.kill(old.pid,0)}catch(e){if(e.code==='ESRCH')stale=true;else throw e;}}catch(e){console.error('另一个窗口正在启动，或运行记录无法读取。');process.exit(1)}
  if(!stale){console.log('慕课工具已经运行，请使用原来的脚本窗口。');process.exit(0)}
  fs.renameSync(lock,lock+'.previous-'+Date.now());fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});
}
process.on('exit',()=>{try{if(JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock)}catch{}});
const reviewDir=path.join(root,'review'),started=Date.now();fs.mkdirSync(reviewDir,{recursive:true});
const env={...process.env,UOOC_AUTO_UNFINISHED:'1',UOOC_HUMAN_REVIEW_DIR:reviewDir,UOOC_SUPERVISED:'0',UOOC_PICK_COURSES:process.env.UOOC_PICK_COURSES||'0'};
for(const key of ['UOOC_MANUAL_COURSES','UOOC_TARGET_COURSES','UOOC_COURSE_WHITELIST','UOOC_SELECT_ONLY','UOOC_INSPECT_EXAM','UOOC_EXAM_ONLY','UOOC_AUDIT','UOOC_VIDEO_ONLY','UOOC_GRADE_WATCH_PID','UOOC_COLLECT','UOOC_PROBE','UOOC_LIST_ONLY'])delete env[key];
process.env.UOOC_HUMAN_REVIEW_DIR=reviewDir;
console.log('UOOC 慕课学习\n视频：静音 / 2倍速 / 平台打勾即跳过\n课程：自动识别平台未完成的视频和测验\n不确定题会在此窗口要求确认；提交结果不明确时停止重交。\n按 Ctrl+C 停止，请保留此窗口。\n');
const logDir=path.join(root,'logs');fs.mkdirSync(logDir,{recursive:true});
const log=fs.createWriteStream(path.join(logDir,'console-'+new Date().toISOString().replace(/[:.]/g,'-')+'.log'));
let reviewing=false,child,discoveryMissing=false,fallbackUsed=false,outputTail='';
function startChild(){
child=spawn(process.execPath,['start.js'],{cwd:root,env,stdio:[env.UOOC_PICK_COURSES==='1'?'inherit':'ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log.write(chunk);outputTail=(outputTail+chunk.toString()).slice(-8192);if(/仍然没找到课程|课程状态读取失败|任务表缺失/.test(outputTail))discoveryMissing=true;if(!reviewing)process.stdout.write(chunk)});
child.on('error',e=>{console.error('启动失败：'+e.message);process.exit(1)});
child.on('exit',async code=>{
 if(code===2&&discoveryMissing&&!fallbackUsed){
  fallbackUsed=true;const terminal=require('readline/promises').createInterface({input:process.stdin,output:process.stdout});
  try{for(;;){const value=await terminal.question('未识别到可学习课程，可粘贴完整课程/学习页网址（多门用空格分隔，回车退出）：');if(!value.trim())break;try{const links=require('./utils/course-urls').parseCourses(value);env.UOOC_MANUAL_COURSES=links.join('\n');discoveryMissing=false;outputTail='';startChild();return;}catch(e){console.log(e.message)}}}finally{terminal.close();}
 }
 clearInterval(timer);console.log('\n学习进程已结束，退出码：'+code+'。完成情况以平台记录为准。');log.end();process.exit(code||0);
});
}
setImmediate(startChild);
const attempted=new Set();
const timer=setInterval(async()=>{
  if(reviewing)return;
  const pending=fs.readdirSync(reviewDir).filter(n=>n.endsWith('.request.json')&&!fs.existsSync(path.join(reviewDir,n.replace('.request.json','.reply.json')))&&fs.statSync(path.join(reviewDir,n)).mtimeMs>=started);
  const item=pending.find(n=>!attempted.has(n));if(!item)return;
  reviewing=true;attempted.add(item);
  try{console.log('\n需要确认的题目如下：');await require('./review').runReview();}catch(e){console.error('确认失败：'+e.message)}
  finally{reviewing=false;if(!fs.existsSync(path.join(reviewDir,item.replace('.request.json','.reply.json'))))console.log('尚未确认，脚本仍在等待。关闭后重新启动可继续确认。');}
},2000);
process.on('SIGINT',()=>{if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();process.exit(130)});
