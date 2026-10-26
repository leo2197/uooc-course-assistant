$ErrorActionPreference='Stop'
$Host.UI.RawUI.WindowTitle='UOOC课程助手'
Set-Location -LiteralPath $PSScriptRoot
try{
 & (Join-Path $PSScriptRoot 'console-mode.ps1')
 $node=Join-Path $PSScriptRoot 'runtime/node.exe'
 if(-not(Test-Path -LiteralPath $node)){$node=(Get-Command node.exe -ErrorAction Stop).Source}
 & $node (Join-Path $PSScriptRoot 'console.cjs') --check
 if($LASTEXITCODE -ne 0){throw '组件检查失败。请完整解压运行包，或在源码目录运行npm ci。'}
 & $node (Join-Path $PSScriptRoot 'assistant.cjs')
 if($LASTEXITCODE -ne 0){Write-Host '未完成任务或遇到异常，请保留上方报错。' -ForegroundColor Yellow}
}catch{Write-Host $_.Exception.Message -ForegroundColor Red}
