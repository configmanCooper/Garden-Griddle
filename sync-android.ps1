$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
Write-Host 'Web client and Capacitor plugins synced to Android.' -ForegroundColor Green

