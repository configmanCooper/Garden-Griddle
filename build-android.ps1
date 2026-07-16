[CmdletBinding()]
param([switch]$Fast)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$localTools = Join-Path $root 'build-tools'
$sharedTools = 'C:\Users\rocma\CLI\Fish-Friends-Play\build-tools'
$tools = if (Test-Path $localTools) { $localTools } elseif (Test-Path $sharedTools) { $sharedTools } else { $localTools }
$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
if (!$jdk) { throw 'JDK 17 not found. Run setup-android.ps1.' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $tools 'android-sdk'
if (!(Test-Path $env:ANDROID_HOME)) { throw 'Android SDK not found. Run setup-android.ps1.' }

if (!$Fast) {
  & (Join-Path $root 'sync-android.ps1')
}

Push-Location (Join-Path $root 'android')
try {
  & .\gradlew.bat --no-daemon assembleDebug assembleRelease bundleRelease
  if ($LASTEXITCODE -ne 0) { throw "Gradle build failed ($LASTEXITCODE)." }
} finally {
  Pop-Location
}

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Get-ChildItem $dist -Filter 'GardenAndGriddle-*' -ErrorAction SilentlyContinue | Remove-Item -Force
$version = '1.1.0'
$artifacts = @{
  'android\app\build\outputs\apk\debug\app-debug.apk' = "GardenAndGriddle-$version-debug.apk"
  'android\app\build\outputs\apk\release\app-release.apk' = "GardenAndGriddle-$version-release.apk"
  'android\app\build\outputs\bundle\release\app-release.aab' = "GardenAndGriddle-$version-release.aab"
}
foreach ($source in $artifacts.Keys) {
  $path = Join-Path $root $source
  if (!(Test-Path $path)) { throw "Missing Android artifact: $source" }
  Copy-Item $path (Join-Path $dist $artifacts[$source]) -Force
}
Get-ChildItem $dist | Select-Object Name, @{n='MB';e={[math]::Round($_.Length / 1MB, 2)}}
