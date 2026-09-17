$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$assetRoot = Join-Path $projectRoot '.local/live2d'
$downloadRoot = Join-Path $assetRoot 'downloads'
$modelRoot = Join-Path $assetRoot 'models'
$vendorRoot = Join-Path $assetRoot 'vendor'
New-Item -ItemType Directory -Force -Path $downloadRoot, $modelRoot, $vendorRoot | Out-Null

Invoke-WebRequest -Uri 'https://nyarchlinux.moe/Kurisu.zip' -OutFile (Join-Path $downloadRoot 'Kurisu.zip') -UseBasicParsing
Expand-Archive -LiteralPath (Join-Path $downloadRoot 'Kurisu.zip') -DestinationPath $modelRoot -Force
Invoke-WebRequest -Uri 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js' -OutFile (Join-Path $vendorRoot 'live2dcubismcore.min.js') -UseBasicParsing
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js' -OutFile (Join-Path $vendorRoot 'pixi.min.js') -UseBasicParsing
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js' -OutFile (Join-Path $vendorRoot 'cubism4.min.js') -UseBasicParsing
Write-Output 'Live2D assets downloaded. Start the local prototype with npm run live2d:serve.'
