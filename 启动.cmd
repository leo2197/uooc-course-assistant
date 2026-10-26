@echo off
chcp 65001 >nul
if exist "%~dp0entry.ps1" goto ready
echo Please extract ALL files from Windows-x64.zip before starting.
powershell.exe -NoProfile -EncodedCommand WwBDAG8AbgBzAG8AbABlAF0AOgA6AE8AdQB0AHAAdQB0AEUAbgBjAG8AZABpAG4AZwA9AFsAVABlAHgAdAAuAFUAVABGADgARQBuAGMAbwBkAGkAbgBnAF0AOgA6AG4AZQB3ACgAJABmAGEAbABzAGUAKQA7AFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnABAw4GXVbC9UqFIRMAt6j16hbAlnjFt0ZeOJi1MM/xZi6lMNWTZShk4vVKhSh2X2TgIwJwA7AFcAcgBpAHQAZQAtAEgAbwBzAHQAIAAnAPeLc1HtlSxnl3rjUwz/81MulSAAVwBpAG4AZABvAHcAcwAtAHgANgA0AC4AegBpAHAADP8JkOliHCBoUeiQ44mLUx0gAjAnADsAVwByAGkAdABlAC0ASABvAHMAdAAgACcAU2IAX+OJi1MOVIR2h2X2TjlZDP+NUcxT+1EcIC9UqFIuAGMAbQBkAB0gG//BZbmPxV97mN1PWXWMW3RlhHYgAGEAcABwACAAh2X2TjlZAjAnAA==
pause
exit /b 1
:ready
cd /d "%~dp0"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0entry.ps1"
set "courseExit=%errorlevel%"
pause
exit /b %courseExit%
