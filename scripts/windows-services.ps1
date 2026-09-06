param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$amadeusRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $amadeusRoot '.local/windows'
$statePath = Join-Path $runtimeDir 'processes.json'
$logDir = Join-Path $runtimeDir 'logs'

function Get-OwnedProcess($entry) {
    $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $entry.StartTime) {
        return $process
    }
}

$entries = @()
if (Test-Path -LiteralPath $statePath) {
    $entries = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $statePath -Raw)
}
if ($Action -eq 'status') {
    $entries | ForEach-Object { [pscustomobject]@{ Service = $_.Service; Id = $_.Id; Running = [bool](Get-OwnedProcess $_) } } | Format-Table
    exit 0
}
if ($Action -eq 'stop') {
    foreach ($entry in $entries) {
        if (Get-OwnedProcess $entry) {
            & taskkill.exe /PID $entry.Id /T /F
            if ($LASTEXITCODE -ne 0) { throw "Failed to stop $($entry.Service)" }
        }
    }
    Set-Content -LiteralPath $statePath -Value '[]' -Encoding UTF8
    exit 0
}
if ($entries | Where-Object { Get-OwnedProcess $_ }) {
    throw 'Amadeus is already running. Use npm run status:windows or npm run stop:windows first.'
}

$nodeBinary = (Get-Command node.exe).Source
$pythonBinary = Join-Path $runtimeDir 'venv/Scripts/python.exe'
$asrPythonBinary = Join-Path $runtimeDir 'asr-venv/Scripts/python.exe'
if (-not $env:CODEX_BIN) { $env:CODEX_BIN = (Get-Command codex.exe).Source }
$env:AMADEUS_VOICE_ENGINE = 'qwen-tts'
$env:HF_HUB_OFFLINE = '1'
$env:HF_HUB_DISABLE_XET = '1'
$env:OMP_NUM_THREADS = '4'
$env:PYTHONUTF8 = '1'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$services = @(
    @{ Name = 'whisper'; Binary = $asrPythonBinary; Script = 'scripts/asr-api.py' },
    @{ Name = 'qwen'; Binary = $pythonBinary; Script = 'scripts/qwen-api.py' },
    @{ Name = 'web'; Binary = $nodeBinary; Script = 'server/index.mjs' },
    @{ Name = 'remote'; Binary = $nodeBinary; Script = 'server/remote.mjs' },
    @{ Name = 'tunnel'; Binary = $nodeBinary; Script = 'scripts/start-remote-tunnel.mjs' }
)
$entries = @()
foreach ($service in $services) {
    $scriptPath = Join-Path $amadeusRoot $service.Script
    $process = Start-Process -FilePath $service.Binary -ArgumentList ('"{0}"' -f $scriptPath) `
        -WorkingDirectory $amadeusRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir "$($service.Name).out.log") `
        -RedirectStandardError (Join-Path $logDir "$($service.Name).err.log")
    $entries += [pscustomobject]@{ Service = $service.Name; Id = $process.Id; StartTime = $process.StartTime.ToUniversalTime().ToString('o') }
    ConvertTo-Json -InputObject $entries | Set-Content -LiteralPath $statePath -Encoding UTF8
}
$entries | Format-Table Service, Id
Write-Output "Processes launched; model loading continues in the background. Logs: $logDir"
