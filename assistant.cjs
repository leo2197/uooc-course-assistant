const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const root=__dirname,settingsFile=path.join(root,'config/profiles.json');
function profiles(){if(fs.existsSync(settingsFile))return JSON.parse(fs.readFileSync(settingsFile,'utf8'));return {current:'',items:[]};}
function save(value){fs.mkdirSync(path.dirname(settingsFile),{recursive:true});fs.writeFileSync(settingsFile,JSON.stringify(value,null,2));}
function pick(value){const numbers=value.trim().split(/[,，\s]+/).map(Number);if(!numbers.length||numbers.some(x=>!Number.isSafeInteger(x)||x<1))throw Error('请输入课程编号，多个编号用空格分隔');return [...new Set(numbers)];}
async function main(){
 const rl=require('readline/promises').createInterface({input:process.stdin,output:process.stdout});
 try{let selected=profiles();if(!selected.items.length){const legacy=fs.existsSync(path.join(root,'config.txt')),id=legacy?'legacy':crypto.randomUUID();selected={current:id,items:[{id,label:legacy?'原本地账号':'账号1'}]};save(selected);}
 if(!fs.existsSync(require('./provider.cjs').file)&&!fs.existsSync(path.join(root,'config.txt'))){setup();}
 for(;;){console.log('\nUOOC课程助手｜当前浏览器资料：'+selected.items.find(x=>x.id===selected.current).label+'\n1 开始/继续（编号选课）\n2 模型设置\n3 切换或添加账号\n4 自动处理所有未完成课程\n0 退出');const choice=(await rl.question('请选择 [1]：')).trim()||'1';if(choice==='0')return;
  if(choice==='2'){setup();continue;}
  if(choice==='3'){selected.items.forEach((x,i)=>console.log((i+1)+'. '+x.label));const answer=await rl.question('账号编号；N添加独立账号：');if(/^n$/i.test(answer.trim())){const label=(await rl.question('账号备注（只保存在本机）：')).trim()||'账号'+(selected.items.length+1),id=crypto.randomUUID();selected.items.push({id,label});selected.current=id;}else{const item=selected.items[Number(answer)-1];if(!item){console.log('无效编号');continue;}selected.current=item.id;}save(selected);continue;}
  if(!['1','4'].includes(choice)){console.log('请输入菜单编号');continue;}
  rl.close();const result=spawnSync(process.execPath,[path.join(root,'console.cjs')],{cwd:root,env:{...process.env,UOOC_PROFILE_ID:selected.current==='legacy'?'':selected.current,UOOC_PUBLIC_UI:'1',UOOC_PICK_COURSES:choice==='1'?'1':'0'},stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status||0;return;
 }
 }finally{rl.close();}
}
function setup(){const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'setup.ps1'),'-NodePath',process.execPath],{stdio:'inherit'});if(r.status!==0)throw Error('模型尚未配置成功，可重新运行设置。');}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={pick};
