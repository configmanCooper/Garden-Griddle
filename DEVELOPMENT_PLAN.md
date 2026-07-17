# Garden & Griddle — Reviewed Master Plan

## 1. Product vision

**Garden & Griddle** is an online two-player cooperative restaurant game designed first for phones and also playable in desktop browsers. Both players share one restaurant and may perform every task; there are no locked roles.

The core loop is deliberately readable and tactile:

1. Plant and water ingredients in the garden.
2. Harvest ripe ingredients directly into the shared fridge.
3. Milk the cow whenever its single milk unit is ready.
4. Mix flour, sugar, and milk into a batter batch worth 5 crepes.
5. Assign customer orders to one of three stovetops.
6. Serve finished crepes before customers lose patience.
7. Earn 1–3 stars during each three-minute day.
8. Spend earned stars on upgrades and continue through 100 days.

The tone is warm, cheerful, cooperative, and low-stress at early levels, with increasingly lively coordination demands later.

## 2. Reviewed design decisions

Four independent reviews were commissioned before implementation:

| Review | Main decision incorporated |
|---|---|
| Game-code architecture | Combine FourPillars’ authoritative multiplayer spine with Fish Friends’ DOM-free, deterministic, headless-testable simulation discipline. |
| Mobile UI/UX | Use landscape, safe-area-aware touch UI, large contextual controls, clear partner presence, direct visual progress, and forgiving latency feedback. |
| Three.js graphics | Use a fixed orthographic diorama, procedural low-poly models, canvas-generated textures, fake contact shadows, instancing, and no dynamic shadow maps. |
| Networking/Android | Use a dedicated two-player Socket.IO service, signed reconnect sessions, sequenced/idempotent actions, version-gated clients, and a bundled Capacitor Android client that connects over HTTPS/WSS. |

The reviews also identified two issues that receive first-class implementation and testing:

- **Shared-resource races:** both players may tap the same crop, cow, order, or stove at nearly the same time.
- **Mobile network interruption:** a player may disconnect, background the app, or reconnect during a live day.

## 3. Scope and assumptions

- Online cooperative play supports exactly two active player seats per room.
- A host may start a solo-practice day, but the intended experience is two players. Solo days use an authored 0.5 arrival-rate multiplier and are validated separately so all 100 days remain passable without pretending one player has two-player throughput.
- Players are symmetric and can perform every action.
- The server is authoritative for all game rules, timers, inventory, scoring, and progression changes.
- The web client and Android app contain presentation and input only; neither can award resources or complete actions locally.
- The first deployment target is a dedicated Render Web Service, matching the hosting model already used by FourPillars. It should be a separate service so deployments and load are isolated.
- Static client assets are served by the same Node service on web. The Android app bundles those assets locally and connects to the official server URL.
- No accounts, ads, purchases, analytics, or chat are included in the initial release.

## 4. Detailed gameplay design

### 4.1 Garden

The garden contains 12 raised plots and one shared watering pail.

Each day starts with 20 seeds for every crop:

| Crop shown to player | Fridge result | Base growth after watering |
|---|---:|---:|
| Wheat | Flour | 3 seconds |
| Sugar cane | Sugar | 5 seconds |
| Strawberry | Strawberry | 7 seconds |
| Blackberry | Blackberry | 9 seconds |
| Lemon tree | Lemon | 12 seconds |
| Banana plant | Banana | 15 seconds |

Plot states:

`empty → planted/dry → watering → growing → ripe → harvested/empty`

- Planting consumes one matching seed.
- A planted crop does not grow until watered.
- Watering requires the player to hold the shared pail.
- The pail must be put down before planting.
- The pail starts empty, is filled at the kitchen sink, and waters 5 plants before it must be refilled.
- Base planting time is 0.4 seconds, watering time is 1.2 seconds, and harvesting time is 0.8 seconds. These are server-owned timed actions with visible progress rings.
- The pail can be picked up by either player and remains visibly associated with its holder until dropped.
- Harvesting adds produce directly to the shared fridge.
- Base harvest yield is 3 units.
- Growth state is represented visually by soil, sprout, young plant, mature plant, and ripe stages.

### 4.2 Cow

- The cow stores at most one milk.
- Milk becomes available every 3 seconds.
- Tapping the ready cow transfers one milk directly to the shared fridge.
- If milk is not collected, the cow remains full and does not accumulate additional milk.

### 4.3 Fridge and batter

The fridge tracks:

- flour
- sugar
- milk
- strawberries
- blackberries
- bananas
- lemons

One batter batch costs:

- 3 flour
- 3 sugar
- 3 milk

The mixer takes 3 seconds and creates 10 batter portions. Batter is shared and has a visible gauge. The batch-size upgrade can increase the number of portions produced.

### 4.4 Orders and recipes

Customers arrive during service with one recipe and a patience timer. Orders appear as large tickets with ingredient silhouettes, not color alone.

Initial recipe set:

| Recipe | Toppings consumed |
|---|---|
| Lemon Sugar | lemon + sugar |
| Strawberry | strawberry |
| Blackberry | blackberry |
| Banana | banana |
| Strawberry Sugar | strawberry + sugar |
| Blackberry Sugar | blackberry + sugar |
| Banana Sugar | banana + sugar |
| Strawberry Banana | strawberry + banana |
| Forest Berry | strawberry + blackberry |
| Citrus Berry | lemon + strawberry + sugar |

Every crepe also consumes one batter portion.

Recipe complexity unlocks gradually:

- Levels 1–5: first 3 recipes
- Levels 6–10: first 4 recipes
- Levels 11–15: first 5 recipes
- Levels 16–20: first 6 recipes
- Levels 21–25: first 7 recipes
- Levels 26–30: first 8 recipes
- Levels 31–40: first 9 recipes
- Levels 41–50: all 10 recipes

### 4.5 Three stovetops

Each stovetop has these states:

`empty → cooking first side → flip prompt → cooking second side → ready → burnt → cleaned/empty`

- A player selects an order ticket and then taps an empty stove.
- The server atomically claims the order and stove, consumes one batter and the exact toppings, and starts cooking.
- Base cook time is 6 seconds: 3 seconds on each side.
- Halfway through cooking, the stove turns blue and the player must tap it to flip the crepe within 4.5 seconds.
- Crepe toppings are visually added only after a successful flip.
- A ready crepe has a 7.5-second base grace period before burning.
- Serving a ready crepe is a 0.6-second timed action.
- Clearing a burnt stove is a 0.8-second timed action and records waste.
- Simultaneous claims are resolved on the server; exactly one player succeeds.

### 4.6 Customers, eating, and payment

- Served customers visibly receive the crepe, eat for 4 seconds, then pay.
- Payment produces restaurant coins and a tip based on remaining patience.
- Coins are an end-of-day performance statistic, not a second upgrade currency.
- Stars remain the only progression currency.
- Expired customers leave unhappy and count as missed.
- Burnt or abandoned assigned orders count as missed when their patience expires.

### 4.7 Day structure and star rating

Every level is exactly 180 seconds:

- Prep phase: 60 seconds on Day 1, then 30 seconds on Days 2–100 before the first customer arrives.
- Service phase: remainder of the day.
- No new customers spawn during the final 8 seconds.
- Existing customers must still be served before the clock reaches zero.
- If the active-order queue is full, a scheduled arrival is deferred rather than counted as a missed customer; only customers actually spawned are included in the star denominator.

Stars are based on the fraction of customers correctly served:

- 1 star: at least 50%
- 2 stars: at least 70%
- 3 stars: at least 90%

A level is passed with at least one star. Replaying a level only awards newly improved stars, preventing infinite star farming.

## 5. Fifty-level difficulty curve

Levels are generated from authored formulas plus milestone overrides, not 50 duplicated rule blocks. A Phase-1 production-ceiling validator compares maximum human-rate garden, milk, batter, and stove throughput against each level’s peak demand. If a formula exceeds the authored feasibility margin, the level compiler automatically lengthens the order interval before the level can ship.

Primary difficulty dimensions:

- customer arrivals are reduced to roughly half of the 1.3.2 schedule across all 100 days
- patience: 20% above the original curve, from approximately 48 seconds early to 21.6 seconds at maximum difficulty
- prep duration: 15 seconds to 8 seconds
- active recipe variety: 3 to 10
- queue cap: 3 to 8
- higher chance of two- and three-topping recipes
- smaller burn grace reductions on milestone levels

Milestone levels 10, 20, 30, 40, and 50 receive themed rush patterns:

- 10: Berry Brunch
- 20: Lemon Festival
- 30: Banana Bonanza
- 40: Garden Gala
- 50: Grand Crepe Jubilee

The balance target assumes two casual players provide approximately 1.6 times solo throughput, not a perfect 2 times multiplier.

## 6. Upgrade shop

The campaign contains 12 upgrades with five tiers each. A perfect campaign cannot maximize everything, preserving meaningful choices.

| Upgrade | Effect per tier |
|---|---|
| Green Thumb | Crops grow 6% faster |
| Quick Pour | Watering completes 15% faster |
| Bountiful Baskets | 12% chance per harvested unit to add a bonus unit |
| Nimble Harvester | Harvesting completes 12% faster |
| Happy Cow | Milk recharges 8% faster |
| Full Pail | 15% chance to collect a bonus milk |
| Swift Whisk | Batter mixing is 12% faster |
| Bigger Bowl | Batter batches produce +2 portions |
| Hot Griddles | Crepes cook 7% faster |
| Forgiving Heat | Ready crepes gain +1.5 seconds before burning |
| Cozy Cafe | Customers have 5% more patience |
| Fast Service | Serving and clearing complete 10% faster |

Tier costs are 2, 4, 6, 8, and 10 stars, for 30 stars per fully upgraded item and 360 stars for all upgrades. A perfect 100-day campaign contains 300 total stars, so players must specialize.

## 7. Multiplayer and server architecture

### 7.1 Components

```
server.js                 Express, security middleware, Socket.IO, health endpoint
server/rooms.js           two-seat room lifecycle, reconnect, host transfer, tick loop
shared/constants.js       protocol events, entity ids, recipes, crop ids
shared/balance.js         all tunable values, levels, upgrades
shared/schema.js          state factories, normalization, campaign validation
shared/rng.js             deterministic seeded random generator
shared/sim.js             pure step/applyAction/snapshot logic; no DOM or Three.js
public/js/net.js          versioned Socket.IO protocol wrapper
public/js/state.js        latest authoritative state and interpolation metadata
public/js/render3d.js     Three.js presentation only
public/js/ui.js           screens, HUD, tickets, modals, accessibility
public/js/input.js        pointer/raycast/keyboard intents
public/js/audio.js        generated WebAudio cues
public/js/save.js         versioned local campaign persistence
public/js/main.js         screen controller and render loop
```

### 7.2 Protocol

Every action uses an envelope:

```js
{
  protocol: 1,
  clientBuild: "1.0.0",
  seq: 42,
  actionId: "random-128-bit-id",
  action: "water",
  payload: { plotId: "plot-4" }
}
```

The reconnect token is authenticated once in the Socket.IO handshake, bound to that socket, and rotated after a successful reconnect; it is not repeated in every action packet.

Server rules:

- validate protocol and minimum client build during connection
- allowlist production web origins and the Capacitor local origin
- cap transport packet size and validate every payload shape, enum, string, and length
- rate-limit per IP, session, and room using thresholds proven not to reject legitimate rapid play
- reject stale sequence numbers
- deduplicate action IDs
- compute all deadlines from server simulation time
- immediately ACK accepted or rejected actions
- immediately broadcast a compact snapshot after successful actions
- send regular snapshots at 10 Hz while the simulation steps at 20 Hz

### 7.3 Rooms and reconnects

- Human-readable six-character room code, excluding ambiguous characters, with strict join-attempt throttling and short room expiry.
- Cryptographically random signed session token per seat.
- Shared invitation links also contain a separate expiring 128-bit join token; Android App Links open them directly in the installed app and the native share action sends the same HTTPS link.
- Capacity is exactly two active seats.
- Reconnecting with a valid token restores the same seat.
- A valid reconnect token can reclaim its original seat for the full 30-minute room lifetime. After 120 seconds the display-code seat may be claimed by a new player, which invalidates the old token.
- A disconnected player’s active locks and held pail are released safely according to each action’s cancellation rule.
- If both players disconnect, the day pauses until a valid player returns or the room expires.
- If one player disconnects, the day continues and the remaining player sees a prominent reconnect banner.
- Host transfers to the remaining connected player.
- Empty rooms expire after 30 minutes.
- A planned deploy drains connections and refuses new days before shutdown. An unexpected process restart aborts active days without awarding stars and clients receive a clear “day interrupted—no progress lost” result instead of reconnecting forever.
- In solo or two-player rooms, either connected player may directly pause or unpause at any time without a vote. A pause automatically expires after 5 minutes. Backgrounding one phone does not automatically pause the other player.

### 7.4 Shared-resource concurrency

All contendable entities contain explicit ownership/lock fields with short expiry:

- watering pail
- plots during watering or harvesting
- cow during collection
- mixer during mixing
- orders during assignment
- stovetops during assignment or serving

Timed interactions use explicit `begin → complete` or `begin → cancel` state machines. Disconnecting or losing ownership cancels planting, watering, harvesting, milking, serving, and clearing without granting output; mixer and stove timers are station-owned after their ingredients are atomically committed and continue safely. Actions are processed serially by the Node event loop. The first valid action wins; later conflicting actions receive a structured `taken` rejection. Tests must prove no double inventory gain, double order completion, or leaked lock.

## 8. Phone-first UI/UX

### 8.1 Orientation

- Android locks to landscape.
- Web supports landscape as the primary layout.
- Portrait shows a friendly rotate prompt rather than compressing controls.
- All panels account for `env(safe-area-inset-*)`.
- Interactive targets are at least 48 CSS pixels.

### 8.2 Core layout

- Top left: vertically stacked order tickets, nearest expiry emphasized.
- Top center: day timer and current star progress.
- Top right: connection/partner indicator and pause/settings button.
- Bottom center: contextual status for the selected object or held pail.
- Resource/fridge strip: compact ingredient counts that can expand into a full panel.
- The full diorama fits in the default overview. Drag-to-pan and pinch/wheel-to-zoom are optional precision tools, not required camera-mode buttons.

### 8.3 Interaction model

The game uses direct object tapping rather than free-roam joystick movement. This is a deliberate management-game choice:

- tap an empty plot to choose a seed
- tap the pail to pick it up
- tap the kitchen sink while holding the pail to fill all 5 charges
- tap a dry crop once while equipped with the pail; the chef remains busy there until watering completes
- tap the held-item display to drop the pail immediately
- tap a ripe crop to harvest
- tap the ready cow to milk
- tap the mixer to start batter
- tap an order, then tap a stove
- tap a ready or burnt stove to resolve it
- tapping outside a valid target cancels the current order or seed selection

Characters automatically walk a short path to the selected station, making actions feel physical without forcing precise phone movement controls.

The current crop selection is always shown above the bottom HUD; tapping another empty plot plants that visible selection. Drag panning supports a wide world range, with on-screen arrow buttons for phones where menus reduce the available gesture area.

Desktop adds mouse hover outlines and keyboard shortcuts while preserving identical rules.

Camera pan/zoom, hover state, and current order/seed selection are always client-local presentation state. They are never written to or broadcast in the authoritative simulation snapshot.

### 8.4 Cooperative communication without chat

- Each player has a distinct color and apron pattern.
- The partner’s avatar and current action are visible.
- Order tickets display the avatar color of the player who assigned them.
- An off-screen partner arrow appears in focused camera views.
- Quick pings provide “I’ll garden,” “I’ll cook,” “Need milk,” and “Rush order” messages.

No free-text chat is included, reducing moderation and child-safety scope.

### 8.5 Accessibility

- Ingredient shape/icon and label always accompany color.
- Reduced motion, high contrast, music, SFX, and vibration toggles.
- Reduced motion shortens camera movement, disables crop sway and non-critical particle bursts, and removes pulsing while preserving static patience and cook-state indicators.
- Hold interactions can be changed to tap-to-start.
- Critical information never relies on audio, vibration, or color alone.
- Rejected network actions receive a gentle bounce and clear text reason, not a blocking error.

## 9. Three.js visual direction

### 9.1 Scene

A single warm diorama joins:

- a fenced 12-plot garden
- cow pasture
- glass-front fridge
- batter counter and mixing bowl
- three crepe stovetops
- serving counter
- customer patio tables

The renderer uses an orthographic camera at a fixed 30–35 degree elevation and fixed azimuth. Panning and zooming never change that angle, keeping contact shadows and interaction hit areas consistent.

### 9.2 Art style

- Rounded low-poly procedural geometry.
- Cream, caramel, terracotta, leafy green, berry red, lemon yellow, and blackberry purple palette.
- Canvas-generated in-world topping atlas and effect sprites. Order tickets, ingredient silhouettes, patience indicators, and all critical text remain crisp DOM/CSS overlays outside the capped-resolution WebGL canvas.
- Batter visibly enters the bowl as flour, sugar, and milk before a countertop blender mixes it.
- Crepes begin plain, animate through a halfway flip, and receive their topping atlas only on the second side.
- Pattern-coded aprons and ingredients for colorblind readability.
- Fake radial contact-shadow quads; no real-time shadow maps.
- Ambient plus one warm directional light.
- Gradient sky and ground colors that shift subtly through the three-minute day through cheap material/uniform color interpolation, never per-frame CPU rewrites of geometry buffers.

### 9.3 Animation and effects

- Crops smoothly scale through growth stages and sway.
- Water droplets, flour puffs, steam, plating sparkles, and payment stars use pooled particles.
- Stove rings fill while cooking and pulse when ready.
- Customers show a radial patience ring and visible eating/payment states.
- Players walk to stations with lightweight tweened procedural animation.

### 9.4 Performance budgets

- target 60 FPS on mid-tier Android with a hard 30 FPS floor
- pixel ratio capped at 2, with a 1.5 low-power option
- no post-processing
- under 120 draw calls in normal play
- under 250,000 triangles
- under 96 MB estimated texture memory
- crops, chairs, plates, tables, and repeated decor instanced where useful
- no external model or texture downloads
- if measured FPS remains below 30 for more than 3 seconds, reduced-effects mode lowers pixel ratio, particle counts, and decorative shadow decals automatically

Worst-case performance census:

- 12 mature crops, 8 customers, 2 player avatars, 3 active stoves, cow, restaurant fixtures, full UI, and overlapping watering/steam/payment particles
- automated smoke instrumentation must keep this peak scene under the draw-call, triangle, texture-memory, and frame-time budgets above

## 10. Campaign persistence

Local versioned save data stores:

- unlocked level
- best stars for each level
- unspent stars
- upgrade tiers
- settings
- last player name
- official server URL override for development

The host uploads a normalized campaign snapshot when creating a room. The room server owns changes only for that live room and broadcasts the resulting campaign after results or purchases. Both clients save that room result locally so either can host the next session.

This initial progression is intentionally local and untrusted: a player can edit or fork their own save, and concurrent rooms may diverge. That is acceptable because there are no purchases, accounts, competitive leaderboards, or rewards with external value. The UI and documentation make no claim that local stars are server-secured. Save revisions prevent accidental stale overwrites on one device, while account-backed persistence can be added later without changing simulation rules.

## 11. Android / Google Play build

- Capacitor 6 Android wrapper.
- App id: `com.configmancooper.gardenandgriddle`
- App name: `Garden & Griddle`
- Bundled web client loaded from the secure local Capacitor origin.
- `INTERNET` permission only.
- Cleartext traffic disabled.
- Navigation restricted to local assets and the official HTTPS game host.
- Landscape orientation.
- Android App Link handling for official invitation URLs and a native share action.
- Minimum Android 7.0 / API 24 with a current WebView; boot performs a WebGL2 capability check and shows a clear unsupported-device screen instead of a blank canvas.
- Build scripts produce:
  - debug APK
  - signed release APK
  - signed release AAB for Google Play
- Play App Signing is recommended.
- A dedicated upload keystore is generated locally and never committed.
- Store icon, feature graphic, screenshots, privacy policy, and listing text are included.
- Data Safety disclosure will state that the game uses network communication and temporary room/session identifiers but has no accounts, ads, analytics, location, contacts, or sale of data.
- Target the Play-required API level current at release (API 36 for the planned 2026 submission), run the Play pre-launch report, complete content rating, and disclose short-lived IP/session/security logs and their retention in the privacy policy.

## 12. Test strategy and release gates

### 12.1 Headless simulation

- exact initial seed counts
- planting, watering, harvesting, serving, and clearing durations
- every crop’s growth duration
- dry plants do not grow
- harvesting yields correct fridge resources
- cow stores only one milk
- batter costs and produces correct portions
- three independent stovetops
- order expiry, serve, eating, payment, burn, and waste
- star thresholds and improved-star-only rewards
- all 12 upgrade effects and caps
- deterministic result for same seed and action script

### 12.2 Concurrency

- simultaneous double harvest grants inventory once
- simultaneous cow collection grants milk once
- simultaneous stove/order assignment has exactly one winner
- duplicate action ID cannot repeat an accepted action
- stale sequence cannot mutate state
- disconnect releases pail and locks
- disconnect during every timed action follows its authored cancel/continue rule

### 12.3 Balance automation

Two cooperative bots run all 100 days:

- skilled/max-upgrade bots must be able to earn 3 stars on every level
- competent mid-upgrade bots should pass every level
- idle or intentionally wasteful bots must fail
- simulation remains deterministic across repeated sweeps
- bots are limited to authored human reaction latency and actions-per-minute; a level fails validation if success requires more than 80% of the two-player human input ceiling
- a Phase-1 numeric production-ceiling check validates the single-pail garden bottleneck before the 100-day curve is accepted

### 12.4 Network integration

- create and join a room with two Socket.IO clients
- reject a third player
- both clients converge on the same snapshot
- reconnect resumes the correct seat
- host transfer works
- protocol/build mismatch receives a clear failure
- room and health endpoints survive a full scripted day
- forged/rotated/replayed token rejection, invite expiry, oversized and malformed packet rejection, origin rejection, protocol downgrade rejection, XSS-safe names, and rate-limit behavior
- an unexpected restart aborts an active day without awarding campaign progress and produces a recoverable client message

### 12.5 Browser and Android

- real Chromium smoke test boots Three.js and renders the scene
- touch/raycast actions complete a short scripted workflow
- landscape and safe-area layout checks
- losing a simultaneous harvest or stove race cleanly reverts local animation/selection and displays non-blocking `taken` feedback
- two browser clients remain converged while using different local camera/selection states
- smoke instrumentation asserts peak `renderer.info` draw calls/triangles, estimated texture memory, and frame-time budgets
- Android debug APK builds
- release AAB builds when signing material exists
- local Android client reaches the configured HTTPS server
- debug and release builds install on an Android 10+, 3 GB RAM, Adreno 6xx-class target or equivalent emulator/device; complete one full 180-second day at a sustained 30 FPS floor
- Android background/foreground reconnect, App Link launch, HTTPS-only enforcement, WebGL capability failure, and WebGL context-loss recovery are exercised

## 13. Implementation phases and commit gates

### Phase 0 — Reviewed plan and repository

Deliverables:

- project name and repository
- this master plan
- reviewer findings integrated

Commit gate: plan receives independent game-code, mobile UI, graphics/performance, and networking/Android critiques and all blocking contradictions are addressed.

### Phase 1 — Deterministic simulation core

Deliverables:

- shared constants, balance, levels, RNG, schema, simulation
- garden, cow, fridge, batter, orders, stoves, scoring, stars, upgrades
- comprehensive headless tests and first balance bots

Commit gate: core, determinism, concurrency, human-APM, and production-ceiling tests pass.

### Phase 2 — Authoritative two-player server

Deliverables:

- Express and Socket.IO server
- signed session/reconnect tokens
- two-seat rooms, host transfer, room expiry
- action envelope validation, sequencing, deduplication, throttling
- health endpoint and Render deployment file
- two-client integration tests

Commit gate: complete scripted two-client day, reconnect, hostile-client security, and restart-abort tests pass.

### Phase 3 — Phone-first Three.js client

Deliverables:

- procedural restaurant/garden scene
- raycast input and contextual UI
- lobby, room, level select, live day, results, and settings screens
- partner avatars, pings, order queue, fridge, pail, mixer, stoves, customers
- responsive desktop adaptation

Commit gate: two Chromium clients complete plant → water → harvest → batter → cook → serve, remain converged, and recover correctly from a scripted conflicting interaction.

### Phase 4 — Campaign and upgrade progression

Deliverables:

- all 100 days
- milestone rushes
- improved-star rewards
- 12-upgrade shop
- versioned local persistence and authoritative room sync
- full 100-day bot balance sweep

Commit gate: progression tests, solo/two-player sweeps, human-APM limits, and all balance feasibility checks pass.

### Phase 5 — Android and store package

Deliverables:

- Capacitor Android project
- generated icons and splash screens
- Play Store feature graphic and listing
- privacy policy
- build/setup scripts
- APK/AAB output

Commit gate: Android debug APK and signed release AAB build successfully; the installed client opens an invitation link, reconnects after backgrounding, reaches the HTTPS server, and completes a scripted day.

### Phase 6 — Polish, audit, and release candidate

Deliverables:

- procedural audio
- particles, animations, camera transitions, haptics, accessibility
- performance/debug overlay
- deployment documentation
- final independent game-code, network, UI, and graphics reviews
- fixes for every high-confidence blocker

Commit gate: all automated tests pass, browser smoke and numeric graphics budgets pass, an installed Android build sustains the 30 FPS floor for a full day, and final reviews report no unresolved blocker.

## 14. Explicit non-goals for the first release

- competitive play
- more than two active players
- accounts or passwords
- free-text chat
- ads or in-app purchases
- user-generated content
- imported commercial asset packs
- physics-based character movement
- native iOS package
