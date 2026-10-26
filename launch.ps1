param([switch]$Check, [string]$ReadyFile)
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'UOOC Course Learning'
Set-Location -LiteralPath $PSScriptRoot
try {
    & (Join-Path $PSScriptRoot 'console-mode.ps1')
    $node=Join-Path $PSScriptRoot 'runtime/node.exe';if(-not(Test-Path -LiteralPath $node)){$node=(Get-Command node.exe -ErrorAction Stop).Source}
    & $node (Join-Path $PSScriptRoot 'console.cjs') --check
    if ($LASTEXITCODE -ne 0) { throw 'UOOC startup check failed.' }
    if ($ReadyFile) { @{status='ready'; pid=$PID} | ConvertTo-Json | Set-Content -LiteralPath $ReadyFile -Encoding UTF8 }
    if (-not $Check) { & $node (Join-Path $PSScriptRoot 'assistant.cjs') }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($ReadyFile) { @{status='error'; message=$_.Exception.Message; pid=$PID} | ConvertTo-Json | Set-Content -LiteralPath $ReadyFile -Encoding UTF8 }
}
Read-Host 'Finished. Press Enter to close'
