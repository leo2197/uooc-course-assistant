// A ZIP preview may extract only this CMD. Never invoke PowerShell until the
// complete application beside it has been found.
function makeLauncher(folder='app'){
 const relative=folder?folder+'\\entry.ps1':'entry.ps1';
 const notice=Buffer.from("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Write-Host '【无法启动】程序没有完整解压，或只复制了启动文件。';Write-Host '请关闭本窗口，右键 Windows-x64.zip，选择“全部解压”。';Write-Host '打开解压后的文件夹，再双击“启动.cmd”；旁边必须保留完整的 app 文件夹。'",'utf16le').toString('base64');
 return ['@echo off','chcp 65001 >nul',`if exist "%~dp0${relative}" goto ready`,
 'echo Please extract ALL files from Windows-x64.zip before starting.',
 'powershell.exe -NoProfile -EncodedCommand '+notice,
 'pause','exit /b 1',':ready',`cd /d "%~dp0${folder}"`,'if errorlevel 1 exit /b 1',
 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0${relative}"`,
 'set "courseExit=%errorlevel%"','pause','exit /b %courseExit%',''].join('\r\n');
}
module.exports={makeLauncher};
