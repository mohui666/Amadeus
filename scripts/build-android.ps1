$ErrorActionPreference = 'Stop'
$amadeusRoot = Split-Path $PSScriptRoot -Parent
Push-Location $amadeusRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    & ./android/gradlew.bat -p android assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    $outputDir = Join-Path $amadeusRoot 'artifacts/android'
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $amadeusRoot 'android/app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $outputDir 'Amadeus.apk') -Force
    Write-Output "APK: $outputDir/Amadeus.apk"
} finally {
    Pop-Location
}
