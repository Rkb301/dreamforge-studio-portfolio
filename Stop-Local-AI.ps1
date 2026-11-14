$ErrorActionPreference = 'Stop'
$dfAiPidFile = Join-Path $PSScriptRoot '.dreamforge-ai.pid'
if (-not (Test-Path -LiteralPath $dfAiPidFile)) { Write-Host 'No Dreamforge local AI process recorded.'; exit 0 }
$dfAiSaved = Get-Content -LiteralPath $dfAiPidFile -Raw | ConvertFrom-Json
$dfAiProcess = Get-Process -Id $dfAiSaved.id -ErrorAction SilentlyContinue
if ($dfAiProcess) {
    if ($dfAiProcess.ProcessName -ne 'ollama' -or $dfAiProcess.StartTime.ToUniversalTime().ToString('o') -ne $dfAiSaved.started) { throw 'The recorded process no longer matches. Nothing was stopped.' }
    Stop-Process -Id $dfAiProcess.Id
}
Remove-Item -LiteralPath $dfAiPidFile
Write-Host 'Dreamforge local AI stopped. Installed models and worlds are unchanged.'
