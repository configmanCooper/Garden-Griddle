# Garden & Griddle

Garden & Griddle is a phone-first online cooperative game for two players. Together, players grow ingredients, milk a cow, prepare batter, cook crepes on three stovetops, and serve a busy restaurant through a 100-day campaign.

The game uses a server-authoritative Node.js + Socket.IO simulation, a procedural Three.js web client, and a Capacitor Android client for Google Play.

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the reviewed design and phased implementation plan.

## Run

```powershell
npm install
npm start
```

Open `http://localhost:3100`. Create a room and share its six-character code with a second browser or phone.

## Test

```powershell
npm test
npm run test:browser
```

The suites cover the deterministic simulation, all 100 days, two-player and solo balance bots, progression, hostile multiplayer cases, reconnects, touch gameplay, two-browser convergence, and worst-case Three.js budgets.

## Android

```powershell
.\setup-android.ps1
.\build-android.ps1
```

Play-ready APK/AAB artifacts are written to `dist\`. See [PUBLISHING-ANDROID.md](PUBLISHING-ANDROID.md).

## Deploy

`render.yaml` defines a single Render Web Service that serves the web client and authoritative Socket.IO server. Set the production `PUBLIC_URL`, `ALLOWED_ORIGINS`, and generated `SESSION_SECRET`, then deploy the repository.
