param()
$ErrorActionPreference = 'Stop'
$dfAiAddress = 'http://127.0.0.1:11435'
$dfAiPidFile = Join-Path $PSScriptRoot '.dreamforge-ai.pid'
$dfAiRunning = $false
try { $null = Invoke-RestMethod -Uri "$dfAiAddress/api/version" -TimeoutSec 2; $dfAiRunning = $true } catch { }
if ($dfAiRunning) {
    if (Test-Path -LiteralPath $dfAiPidFile) {
        $dfAiSaved = Get-Content -LiteralPath $dfAiPidFile -Raw | ConvertFrom-Json
        $dfAiExisting = Get-Process -Id $dfAiSaved.id -ErrorAction SilentlyContinue
        if ($dfAiExisting -and $dfAiExisting.ProcessName -eq 'ollama' -and $dfAiExisting.StartTime.ToUniversalTime().ToString('o') -eq $dfAiSaved.started) {
            Write-Host "Dreamforge's local AI process is already running at $dfAiAddress."
            exit 0
        }
    }
    throw 'Port 11435 is occupied by a process not started by this launcher. No settings were changed. Use your existing server explicitly in Dreamforge Settings, or free this port.'
}
$dfAiCommand = Get-Command ollama.exe -ErrorAction SilentlyContinue
$dfAiExecutable = if ($dfAiCommand) { $dfAiCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
if (-not (Test-Path -LiteralPath $dfAiExecutable)) {
    throw 'Ollama is not installed. Install Ollama and a compatible local model once, then run this launcher again. Dreamforge does not require a subscription or download models automatically.'
}
# Only this child process receives these settings. No global or user configuration is changed.
$dfAiNames = @('OLLAMA_HOST','OLLAMA_NO_CLOUD','OLLAMA_ORIGINS','OLLAMA_DEBUG','OLLAMA_KEEP_ALIVE','OLLAMA_DEBUG_LOG_REQUESTS','OLLAMA_NOHISTORY')
$dfAiPrevious = @{}
foreach ($dfAiName in $dfAiNames) { $dfAiPrevious[$dfAiName] = [Environment]::GetEnvironmentVariable($dfAiName, 'Process') }
try {
    $env:OLLAMA_HOST = '127.0.0.1:11435'
    $env:OLLAMA_NO_CLOUD = '1'
    $env:OLLAMA_ORIGINS = 'http://127.0.0.1:4173,http://127.0.0.1:4184,http://127.0.0.1:5173'
    $env:OLLAMA_DEBUG = '0'
    $env:OLLAMA_DEBUG_LOG_REQUESTS = 'false'
    $env:OLLAMA_NOHISTORY = '1'
    $env:OLLAMA_KEEP_ALIVE = '2m'
    $dfAiProcess = Start-Process -FilePath $dfAiExecutable -ArgumentList 'serve' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'dreamforge-ai.log') -RedirectStandardError (Join-Path $PSScriptRoot 'dreamforge-ai-error.log')
} finally {
    foreach ($dfAiName in $dfAiNames) { [Environment]::SetEnvironmentVariable($dfAiName, $dfAiPrevious[$dfAiName], 'Process') }
}
@{ id = $dfAiProcess.Id; started = $dfAiProcess.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $dfAiPidFile
for ($dfAiAttempt = 0; $dfAiAttempt -lt 30; $dfAiAttempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $dfAiModels = Invoke-RestMethod -Uri "$dfAiAddress/api/tags" -TimeoutSec 1
        $dfAiLog = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'dreamforge-ai-error.log') -Raw
        if ($dfAiLog -notmatch 'Ollama cloud disabled: true') { throw 'The runtime did not confirm cloud features are disabled.' }
        Write-Host "Ready at $dfAiAddress. Cloud models and web search are disabled."
        Write-Host 'In Dreamforge: Settings > Find my local AI > choose a model > enable AI > Save AI settings.'
        Write-Host ('Installed models: ' + (($dfAiModels.models | ForEach-Object { $_.name }) -join ', '))
        Write-Host 'Stop this process with Stop-Local-AI.cmd. No model download was performed.'
        exit 0
    } catch { }
}
Stop-Process -Id $dfAiProcess.Id -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $dfAiPidFile -ErrorAction SilentlyContinue
throw 'Local AI did not become ready. Read dreamforge-ai-error.log in this folder.'
