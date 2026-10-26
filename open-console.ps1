param([string]$ReadyFile, [switch]$Check)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $arguments = @('-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'launch.ps1') + '"'), '-ReadyFile', ('"' + $ReadyFile + '"'))
    if ($Check) { $arguments += '-Check' }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Normal -Verb Open
} catch {
    @{status='error'; message=$_.Exception.Message; pid=$PID} | ConvertTo-Json | Set-Content -LiteralPath $ReadyFile -Encoding UTF8
    exit 1
}
