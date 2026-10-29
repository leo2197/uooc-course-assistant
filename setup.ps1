param([string]$NodePath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$privateDirectory=Join-Path $PSScriptRoot 'config'
[void][IO.Directory]::CreateDirectory($privateDirectory)
Write-Host '先配置模型，再打开网页本人登录。推荐GLM，也支持其他兼容服务。' -ForegroundColor Cyan
Write-Host 'API调用费用以自己的服务商为准。Key管理网页不是API接口地址。'
Write-Host '1 GLM（推荐）：预填官方API地址，填写自己的Key即可。'
Write-Host '2 其他兼容服务：填写服务商提供的Chat Completions API地址和Key。'
do{$service=(Read-Host '选择服务 [1]：').Trim();if(-not $service){$service='1'}}while($service -notin @('1','2'))
if($service -eq '1'){
 $url='https://open.bigmodel.cn/api/paas/v4'
 Write-Host '已选择GLM官方接口。请在智谱开放平台创建自己的API Key，不是网页登录密码。'
}else{
 do{$url=(Read-Host 'API地址（例如 https://你的服务商地址/v1）').Trim()}while(-not $url)
 Write-Host '支持兼容OpenAI Chat Completions协议的服务；请确认该地址不是Key管理网页。'
}
Write-Host '粘贴Key时不显示字符；粘贴后按回车。'
$secret=Read-Host 'API Key' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$apiKey=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
if($apiKey -eq [string][char]22){$apiKey=Get-Clipboard -Raw}
$apiKey=$apiKey.Trim()
if(-not $apiKey -or $apiKey -match '[^\x21-\x7e]'){throw 'Key为空或包含空格、中文、控制字符。请重新复制完整API Key。'}
$model=Read-Host '模型ID（回车尝试自动检测；服务商没有模型列表时请手动填写）'
$judge='';if($model){$judge=Read-Host '裁决模型ID（回车使用同一个模型）'}
$pending=Join-Path $privateDirectory 'provider-pending.dpapi'
try{
 $json=@{url=$url;key=$apiKey;model=$model;judge=$judge}|ConvertTo-Json -Compress
 $encrypted=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($json),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllText($pending,[Convert]::ToBase64String($encrypted))
 do{Write-Host '正在检测模型，可能产生少量API调用费用……'; & $NodePath (Join-Path $PSScriptRoot 'provider.cjs') $pending; if($LASTEXITCODE -eq 0){break};$retry=Read-Host '输入R保留本次输入重试；回车取消，旧设置保留'}while($retry -match '^[rR]$')
 if($LASTEXITCODE -ne 0){throw '模型检测没有通过，原设置保留。'}
}finally{if(Test-Path -LiteralPath $pending){Remove-Item -LiteralPath $pending};$apiKey=$null;$secret=$null;$json=$null}
