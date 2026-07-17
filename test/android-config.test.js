'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const config = JSON.parse(read('capacitor.config.json'));
assert.strictEqual(config.appId, 'com.configmancooper.gardenandgriddle');
assert.strictEqual(config.webDir, 'public');
assert.strictEqual(config.server.androidScheme, 'https');
assert.strictEqual(config.android.allowMixedContent, false);
assert.match(read('public/shared/constants.js'), /CLIENT_BUILD = '1\.3\.0'/);

const variables = read('android/variables.gradle');
assert.match(variables, /minSdkVersion = 24/);
assert.match(variables, /compileSdkVersion = 36/);
assert.match(variables, /targetSdkVersion = 36/);

const gradle = read('android/app/build.gradle');
assert.match(gradle, /applicationId "com\.configmancooper\.gardenandgriddle"/);
assert.match(gradle, /versionCode 10300/);
assert.match(gradle, /versionName "1\.3\.0"/);
assert.match(read('public/js/net.js'), /ggClient/);
assert.match(gradle, /signingConfig signingConfigs\.release/);

const manifest = read('android/app/src/main/AndroidManifest.xml');
assert.match(manifest, /android:screenOrientation="landscape"/);
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(manifest, /android:host="garden-and-griddle\.onrender\.com"/);
assert.match(manifest, /android:pathPrefix="\/join\/"/);
assert.match(manifest, /android\.permission\.INTERNET/);

for (const file of [
  'play-assets/icon-512.png',
  'play-assets/feature-graphic.png',
  'public/privacy.html',
  'public/.well-known/assetlinks.json'
]) assert.ok(fs.existsSync(path.join(root, file)), file + ' should exist.');

const assetLinks = read('public/.well-known/assetlinks.json');
assert.doesNotMatch(assetLinks, /PLAY_SIGNING_SHA256/);
assert.match(assetLinks, /(?:[A-F0-9]{2}:){31}[A-F0-9]{2}/);
assert.match(read('setup-android.ps1'), /GG_KEYSTORE_PASSWORD/);
assert.match(read('setup-android.ps1'), /Read-Host.+-AsSecureString/);

console.log('android config tests: package, API 36, HTTPS, landscape, App Links passed');
