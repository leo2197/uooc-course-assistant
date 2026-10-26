const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
function transform(value,decrypt=false){
 if(process.platform!=='win32')throw Error('当前加密配置仅支持Windows');
 const action=decrypt?'Unprotect':'Protect';
 const code="$ProgressPreference='SilentlyContinue';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$bytes="+(decrypt?'[Convert]::FromBase64String($v)':'[Text.Encoding]::UTF8.GetBytes($v)')+";$result=[Security.Cryptography.ProtectedData]::"+action+"($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write("+(decrypt?'[Text.Encoding]::UTF8.GetString($result)':'[Convert]::ToBase64String($result)')+")";
 return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{input:value,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
}
function read(file){return JSON.parse(transform(fs.readFileSync(file,'utf8'),true));}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',transform(JSON.stringify(value)));fs.renameSync(file+'.tmp',file);}
module.exports={read,write};
