param([string]$NodePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$privateDirectory=Join-Path $PSScriptRoot 'config'
[void][IO.Directory]::CreateDirectory($privateDirectory)
Write-Host '先配置模型，再打开网页本人登录。推荐GLM，也支持其他兼容服务。' -ForegroundColor Cyan
Write-Host 'API调用费用以自己的服务商为准。Key管理网页不是API接口地址。'
$url=Read-Host 'API地址（回车使用GLM官方接口）'
if(-not $url){$url='https://open.bigmodel.cn/api/paas/v4'}
Write-Host '粘贴Key时不显示字符；粘贴后按回车。'
$secret=Read-Host 'API Key' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$apiKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
if($apiKey -eq [string][char]22){$apiKey=Get-Clipboard -Raw}
$apiKey=$apiKey.Trim()
if(-not $apiKey -or $apiKey -match '[^\x21-\x7e]'){throw 'Key为空或包含空格、中文、控制字符。请重新复制完整API Key。'}
$model=Read-Host '模型ID（回车自动识别；熟悉其他服务时可自行指定）'
$judge='';if($model){$judge=Read-Host '裁决模型ID（回车使用同一个模型）'}
$pending=Join-Path $privateDirectory 'provider-pending.dpapi'
try{
 $json=@{url=$url;key=$apiKey;model=$model;judge=$judge}|ConvertTo-Json -Compress
 $encrypted=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($json),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllText($pending,[Convert]::ToBase64String($encrypted))
 do{Write-Host '正在检测模型，可能产生少量API调用费用……'; & $NodePath (Join-Path $PSScriptRoot 'provider.cjs') $pending; if($LASTEXITCODE -eq 0){break};$retry=Read-Host '输入R保留本次输入重试；回车取消，旧设置保留'}while($retry -match '^[rR]$')
 if($LASTEXITCODE -ne 0){throw '模型检测没有通过，原设置保留。'}
}finally{if(Test-Path -LiteralPath $pending){Remove-Item -LiteralPath $pending};$apiKey=$null;$secret=$null;$json=$null}
