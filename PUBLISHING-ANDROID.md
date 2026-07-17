# Publishing Garden & Griddle on Google Play

## Build artifacts

Run:

```powershell
.\setup-android.ps1
.\build-android.ps1
```

The build places these files in `dist\`:

- `GardenAndGriddle-1.2.4-debug.apk`
- `GardenAndGriddle-1.2.4-release.apk`
- `GardenAndGriddle-1.2.4-release.aab`

Upload the `.aab` to Google Play.

## Play Console

Create the app as a **paid game** at **$0.99**. A free app cannot later be changed to paid.

- App id: `com.configmancooper.gardenandgriddle`
- Version code: `10204`
- Version name: `1.2.4`
- Minimum Android: 7.0 / API 24
- Target Android: API 36
- Category: Casual
- Ads: No
- In-app purchases: No
- Internet required: Yes

Listing copy is in `store-listing-android.md`. Graphics are generated into `play-assets\`.

## Signing safety

The local upload key is `android\garden-griddle-upload.keystore` with credentials in `android\keystore.properties`. Both are ignored by Git. Back them up securely and use the same upload key for every update. `setup-android.ps1` reads `GG_KEYSTORE_PASSWORD` or prompts securely; no signing password is committed.

Enable Play App Signing. The certificate used for verified App Links is the **Play app-signing certificate**, not normally the upload certificate.

## Verified invitation links

The Android manifest accepts:

`https://garden-and-griddle.onrender.com/join/ROOMCODE?invite=TOKEN`

After Play App Signing is enabled:

1. Copy the SHA-256 fingerprint from Play Console > App integrity.
2. Replace the upload-certificate fingerprint currently in `public\.well-known\assetlinks.json` with the Play app-signing fingerprint.
3. Deploy the updated web service.
4. Confirm the URL returns JSON with `Content-Type: application/json`.

## Data Safety

Disclose:

- Online multiplayer network communication
- Temporary random room/session identifiers
- IP addresses and connection/security logs retained for up to 30 days
- Local campaign/settings storage
- No accounts, ads, analytics, location, contacts, camera, microphone, or sale of data

Run Internal Testing and the Play pre-launch report before production.
