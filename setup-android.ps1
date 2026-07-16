$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$localTools = Join-Path $root 'build-tools'
$sharedTools = 'C:\Users\rocma\CLI\Fish-Friends-Play\build-tools'
$tools = if (Test-Path $localTools) { $localTools } elseif (Test-Path $sharedTools) { $sharedTools } else { $localTools }

if (!(Test-Path $tools)) {
  throw 'Android toolchain not found. Install JDK 17 and Android command-line tools under build-tools\, or keep the Fish-Friends-Play shared toolchain available.'
}

$jdk = Get-ChildItem (Join-Path $tools 'jdk') -Directory | Where-Object { $_.Name -like 'jdk-17*' } | Select-Object -First 1
if (!$jdk) { throw 'JDK 17 not found.' }
$env:JAVA_HOME = $jdk.FullName
$env:ANDROID_HOME = Join-Path $tools 'android-sdk'
$sdkManager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
if (!(Test-Path $sdkManager)) { throw 'Android sdkmanager not found.' }

Write-Host 'Installing Android API 36 and build tools...' -ForegroundColor Cyan
("y`r`n" * 60) | & $sdkManager --sdk_root="$env:ANDROID_HOME" --licenses | Out-Null
& $sdkManager --sdk_root="$env:ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' | Out-Null

$keystore = Join-Path $root 'android\garden-griddle-upload.keystore'
$properties = Join-Path $root 'android\keystore.properties'
if (!(Test-Path $keystore)) {
  $password = $env:GG_KEYSTORE_PASSWORD
  if (!$password) {
    $secure = Read-Host 'Choose a strong upload-keystore password' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
  if (!$password) { throw 'A non-empty keystore password is required.' }
  & "$($env:JAVA_HOME)\bin\keytool.exe" -genkeypair -v `
    -keystore $keystore -alias gardenandgriddle -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $password -keypass $password `
    -dname 'CN=configmanCooper, OU=Games, O=Cooper Unlimited Games, L=NA, ST=NA, C=US'
  @"
storeFile=garden-griddle-upload.keystore
storePassword=$password
keyAlias=gardenandgriddle
keyPassword=$password
"@ | Set-Content $properties -Encoding ASCII
} elseif (!(Test-Path $properties)) {
  throw 'The keystore exists but android\keystore.properties is missing. Restore the matching private credentials.'
}

"sdk.dir=$($env:ANDROID_HOME -replace '\\','/')" | Set-Content (Join-Path $root 'android\local.properties') -Encoding ASCII
Write-Host 'Android setup complete.' -ForegroundColor Green
