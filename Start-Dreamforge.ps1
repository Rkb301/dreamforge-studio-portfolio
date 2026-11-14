param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$dfProjectRoot = $PSScriptRoot
$dfAddress = 'http://127.0.0.1:4173'
if (-not (Test-Path -LiteralPath (Join-Path $dfProjectRoot 'dist\index.html'))) {
    Push-Location -LiteralPath $dfProjectRoot
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Dreamforge build failed.' } }
    finally { Pop-Location }
}
$dfRunning = $false
try {
    $dfResponse = Invoke-WebRequest -Uri $dfAddress -TimeoutSec 2
    if ($dfResponse.Content -match 'Dreamforge') { $dfRunning = $true }
    else { throw 'Port 4173 is used by another app. Close it before starting Dreamforge.' }
} catch {
    if ($_.Exception.Message -like '*another app*') { throw }
}
if (-not $dfRunning) {
    $dfNode = (Get-Command node.exe).Source
    $dfServerScript = Join-Path $dfProjectRoot 'scripts\serve.mjs'
    $dfProcess = Start-Process -FilePath $dfNode -ArgumentList ('"' + $dfServerScript + '"') -WorkingDirectory $dfProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dfProjectRoot 'dreamforge-server.log') -RedirectStandardError (Join-Path $dfProjectRoot 'dreamforge-server-error.log')
    $dfProcess.Id | Set-Content -LiteralPath (Join-Path $dfProjectRoot '.dreamforge-server.pid')
    for ($dfAttempt = 0; $dfAttempt -lt 30; $dfAttempt++) {
        Start-Sleep -Milliseconds 200
        try { $dfReady = Invoke-WebRequest -Uri $dfAddress -TimeoutSec 1; if ($dfReady.Content -match 'Dreamforge') { $dfRunning = $true; break } } catch { }
    }
    if (-not $dfRunning) { throw 'Dreamforge did not start. Read dreamforge-server-error.log.' }
}
if (-not $NoBrowser) { Start-Process $dfAddress }
