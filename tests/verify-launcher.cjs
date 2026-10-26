const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawnSync}=require('child_process'),{makeLauncher}=require('../launcher.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uooc ZIP 预览 测试-'));
function run(){return spawnSync('cmd.exe',['/d','/c','启动.cmd'],{cwd:dir,input:'\r\n',encoding:'utf8',timeout:20000,windowsHide:true});}
try{fs.writeFileSync(path.join(dir,'启动.cmd'),makeLauncher());let r=run();assert.equal(r.status,1,r.stdout+r.stderr);assert(r.stdout.includes('全部解压'));assert(!r.stdout.includes('does not exist'));
fs.mkdirSync(path.join(dir,'app'));fs.writeFileSync(path.join(dir,'app/entry.ps1'),'\uFEFF[IO.File]::WriteAllText((Join-Path $PSScriptRoot "started"),"ok");exit 0');r=run();assert.equal(r.status,0,r.stdout+r.stderr);assert(fs.existsSync(path.join(dir,'app/started')));
console.log('PASS real CMD: incomplete ZIP gives extraction guide; extracted Chinese/space path starts');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
