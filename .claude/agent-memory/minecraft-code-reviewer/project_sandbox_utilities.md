---
name: mc_execute sandbox utilities
description: Sandbox utilities injected into mc_execute context — what exists and why
type: project
---

# mc_execute Sandbox Utilities (src/tools/mc-execute.ts)

## Navigation
- `pathfinderGoto(goal, timeoutMs?)` — timeout wrapper around bot.pathfinder.goto(). Calls setGoal(null) on timeout to kill zombie pathfinder. Retries with canDig=true on "No path" (but NOT on "goal was changed" — that indicates external interference).
- `multiStagePathfind(x, z, stageDistance?)` — breaks long distances into waypoints. Each stage retries with canDig=true on noPath/timeout (same as pathfinderGoto). Fixed 2026-04-02 session2: previously canDig=false only.
- `escapeWater()` — swim up + navigate to nearest land

## Block Interaction
- `safePlaceBlock(refBlock, faceVec)` — bypasses mineflayer's 5s blockUpdate timeout by using raw `_client.write("block_place", ...)` + 300ms sync
- `fillHoles(radius?)` — fills fall-risk holes with cobblestone/dirt
- `pillarUp(height?)` — builds pillar under bot by jumping + raw block_place (no blockUpdate timeout). Returns { placed, startY, finalY }. Added 2026-04-01. NOTE: bot.pillarUp() does NOT exist on mineflayer Bot — always use this helper.

## Items / Crafting / Farming
- `collectDrops(radius?)` — post-dig/combat item collection. Waits up to 4s for drop entities, then pathfinds to each. Uses gotoWithStuckDetection (not raw pathfinder.goto) to avoid hangs. GoalNear radius=0 for precise approach, 800ms pickup wait. Fixed 2026-04-02.
- `recipesFor(itemIdOrName, meta?, minResultCount?)` — wraps bot.recipesFor() but auto-finds nearby crafting table (≤6 blocks) to return 3x3 recipes too. Accepts numeric item ID OR item name string (e.g. 'bread'). Fixed 2026-04-02: string names were returning [] because bot.recipesFor() needs a numeric id — wrapper now resolves name via registry.
- `craftWithTable(itemName, count?)` — reliable crafting helper. Calls activateBlock(table) + waits for windowOpen event (1s timeout), then calls bot.craft(). Fixes the 40% windowOpen timeout failure in raw bot.craft(). IMPORTANT: always passes minResultCount=1 to recipesFor (not count) to avoid "no recipe found" when bot has single-craft materials. Also adds slot[0] recovery (shift-click) for laggy servers where putAway(0) fails. Returns { crafted, count, tableUsed }. Fixed 2026-04-01.
- `smeltItems(furnaceBlock, inputItemName, fuelItemName, count?)` — opens furnace via activateBlock + windowOpen wait (1s) + bot.openFurnace(), puts fuel+input, waits for smelted output, returns { input, fuel, outputCount }. outputBefore is recorded to avoid false early-resolve when furnace had pre-existing output. Added 2026-04-01. Fixed 2026-04-02: added activateBlock pre-open (same pattern as openChest/craftWithTable) to prevent "Event windowOpen did not fire" timeout.
- `plantSeeds(farmlandBlock, seedItemName?)` — equips seeds + places via raw block_place packet (500ms fallback). Avoids bot.placeBlock() 5s blockUpdate timeout. NOTE: bot.place()/bot.interact() do NOT exist. Added 2026-04-01, fixed from bot.placeBlock to raw packet 2026-04-01.
- `tillLand(dirtBlock)` — equips any hoe, calls activateBlock on dirt/grass block, then WAITS for blockUpdate confirming farmland conversion. Fixes block-state sync issue where activateBlock returns immediately without waiting for server ack, so findBlocks() immediately after would still see "dirt". Returns { tilled, blockName, position }. Added 2026-04-02.
- `applyBoneMeal(targetBlock)` — equips bone_meal, sends raw block_place packet (hand=0), waits up to 500ms for blockUpdate. More reliable than bot.activateBlock() for bone_meal on some server versions. Returns { applied, blockNameAfter }. Added 2026-04-02.

## Container Access
- `openChest(chestBlock)` — reliable chest/barrel/shulker_box opener. activateBlock(chestBlock) + waits for windowOpen (3s timeout), then openContainer(). windowOpen listener registered BEFORE activateBlock to prevent race condition. Skips activateBlock if currentWindow already open. Returns chest window object. Added 2026-04-02. Race fix 2026-04-02. Timeout raised 1.5s→3s 2026-04-02.

## Portal
- `enterPortal(timeoutMs?)` — nether/end portal entry helper. Pathfinds into nearest portal block (≤3 blocks), holds forward key, waits for `respawn` event (dimension change). Returns { success, dimensionBefore, dimensionAfter }. Default timeout 30s. Added 2026-04-02.

## Eating
- `eat()` — uses activateItem + waits for "health" event (avoids entity_status timeout in bot.consume())

## Meta-cognition
- `awareness()` — calls getSurroundings() + appends AutoSafety safetyState scan cache (ores/chests/water) if fresh (< 30s). Fixed 2026-04-02 session2.
- `scan3D(radius?, heightRange?)` — 3D spatial scan with layer views
- `safetyState` — getter (not static property) returning managed.safetyState ?? null. Fixed from static capture to getter 2026-04-01 to avoid null race condition on first call.

## botProxy timeout wrappers (added 2026-04-02 session 3)
- `bot.dig(block)` — wrapped with 15s timeout in botProxy. Without this, a single hang blocks sandbox for 120s (URGENT_BLOCKER_20260402.md).
- `bot.consume()` — wrapped with 5s timeout in botProxy. entity_status packet can be delayed indefinitely.
- `bot.openContainer(block)` — wrapped in botProxy to call activateBlock+windowOpen(3s) before openContainer(). Same pattern as openChest().

## GRACE_PERIOD_MS cap (fixed 2026-04-02 session 3)
- `gotoWithStuckDetection` GRACE_PERIOD_MS was uncapped: could exceed timeoutMs (e.g. grace=22000 > timeout=20000), making stuck detection never fire.
- Fixed: `GRACE_PERIOD_MS = Math.min(cappedThinkTimeout+5000, timeoutMs - STUCK_INTERVAL)`.

## descendSafely() default maxDigAttempts (fixed 2026-04-02 session 3)
- Default was 30 — not enough for Y=73→Y=-59 (132 blocks). Raised to 300.
- Landing wait reduced 500ms→200ms for better throughput.

## windowOpen pre-open timeout unified to 3000ms (fixed 2026-04-02 session 3)
- smeltItems and craftWithTable used 1500ms; openChest used 3000ms. All three now use 3000ms.

## multiStagePathfind targetY + skip intermediate failures (fixed 2026-04-02 session 4)
- `multiStagePathfind(x, z, stageDistance?, targetY?)` now accepts an optional `targetY` argument.
  When provided, the final stage uses GoalNear(x, y, z, 3) so the bot descends/ascends to
  the correct altitude. Critical for Nether navigation (large Y variation between waypoints).
- Intermediate stage failures are now skipped (logged but not thrown) so the bot can advance
  even over partially blocked terrain. Only the final stage re-throws on failure.

## descendSafely free-fall optimization (fixed 2026-04-02 session 4)
- Previously each air/void step waited 500ms (300ms sneak release + 200ms landing check), causing
  a 130-block descent to take 65+ seconds.
- Now: forward nudge (100ms) to step off ledge, then poll onGround every 50ms up to 2s. A single
  attempt covers the entire multi-block free-fall instead of re-entering the loop per block.
- Solid block digs still wait 200ms after dig for physics to settle.

## enterPortal portal-approach path now uses gotoWithStuckDetection (fixed 2026-04-02 session 4)
- Was using raw Promise.race([rawBot.pathfinder.goto, timeout(8000)]) — no stuck detection.
- Fixed to use gotoWithStuckDetection(..., 8000, false) for consistent cleanup and stuck abort.

## Zombie timer fixes (fixed 2026-04-02 session 5)
- gotoWithStuckDetection's stuckCheckTimer (setInterval) and hardTimeoutId (setTimeout) were created
  with native timers, not tracked by clearAllTrackedTimers(). When mc_execute outer timeout fired first,
  these zombies later called rawBot.pathfinder.setGoal(null), interfering with the NEXT mc_execute.
  Fixed: use sandboxSetInterval/sandboxSetTimeout so they are cleaned up on sandbox exit.
- wait() / waitFn used a native setTimeout (void timer). Long await wait(30000) interrupted by outer
  timeout would leave zombie timer. Fixed: use sandboxSetTimeout.
- digWithTimeout and consumeWithTimeout used native setTimeout for their race-against timers.
  Fixed: use sandboxSetTimeout so they are tracked and cleared on sandbox exit.

## bot.consume() airborne guard (fixed 2026-04-02 session 5)
- bot.consume() at Y=135 (airborne) caused instant death on landing due to accumulated fall damage.
  Fixed: consumeWithTimeout now rejects immediately when onGround=false, matching eat()'s guard.
  Fixes bot1_food_death.md ("food consumption causes instant death").

## descendSafely stall detection + escapeWater upward-dig (fixed 2026-04-02 session 6, commit bca1c3a)
- `descendSafely` had no stall detection: if the bot's Y stopped decreasing (stuck against undiggable
  block, broken world state, or unexpected Y drift upward), the loop continued until maxDigAttempts.
  Fixed: every 5 iterations record Y; if 3 consecutive checks show < 0.5 block decrease, abort and
  report "STALL detected". Also abort immediately if Y > startY + 3 (dimension confusion / upward teleport).
  Added early-return when already at targetY. Reason in result log: " (stalled)" / " (maxAttempts)".
  Root-cause evidence: bot1_descendsafely_critical.md — bot at Y=141 digging purpur_block in loop.
- `escapeWater` Phase 2 (land navigation) was only reached after swim-up surfaced. When enclosed by
  cobblestone walls (bot1_water_trap_total_immobility_20260402.md), Phase 1 couldn't surface and Phase 2
  was skipped. Fixed: added Phase 3 — dig solid block above head (or hold jump for water/air above) up to
  8 iterations. If still in water after Phase 3, returns honest message "Water pocket fully enclosed —
  admin teleport required" instead of generic "try digging sideways".

## GoalY silent deadlock fix (fixed 2026-04-02, commit 326a886)
- `GoalY(y)` only specifies a vertical target. pathfinder can silently "succeed" when the bot
  rises 1 block during path computation (even while still deep underground), causing the agent to
  believe navigation is still active while the Promise has already resolved. The agent then waits
  for the outer mc_execute 120s timeout instead of getting a fast error.
- Fixed: both `pathfinderProxy` (wraps `bot.pathfinder.goto()`) and `pathfinderGoto()` sandbox
  helper now detect GoalY and convert it to `GoalNear(currentX, targetY, currentZ, 2)`. The
  converted goal fails fast with "noPath" when the path is blocked, triggering canDig=true retry.
- Root cause evidence: claude1_post_phase8_pathfinder_deadlock_20260402.md (bot at Y=74 underground,
  GoalY(80), position unchanged for 120s with no error message).

## Position / Physics sync
- `waitForChunksToLoad(timeoutMs?)` — waits for chunkColumnLoad event confirming bot position chunk is loaded. Call after /tp or dimension change when bot.blockAt() returns null.
- `resyncPhysics(timeoutMs?)` — sends a serverbound position_look packet and waits for forcedMove (server ack). Breaks rubber-band state where server continuously resets bot position to teleport coordinates. Symptom: position frozen, look/pathfinder don't work, velocity.y != 0 but X/Z never change. Added 2026-04-02.

## Physics freeze auto-fix on dimension change (fixed 2026-04-02, commit 5eed37c)
- Root cause: mineflayer physics.js fires `bot.on('respawn', ...)` → `shouldUsePhysics = false`.
  shouldUsePhysics only resets to true when the server sends a clientbound `position` packet.
  On some server versions this packet is delayed or never arrives after the_end→overworld
  transition, leaving the bot completely frozen (setControlState/pathfinder/placeBlock all stop
  working). Symptom: bot appears connected and reports correct position, but no movement input
  has any effect. Evidence: bot1_TERMINAL_SYSTEM_DEADLOCK.md, bot1_water_trap_total_immobility.md.
- Fix: `bot.on("spawn", ...)` dimension-change block in bot-core.ts now sends a `position_look`
  packet 500ms after the dimension change. This prompts the server to respond with its own
  `position` packet, triggering `forcedMove` and resetting `shouldUsePhysics = true`.
  The 500ms delay allows the handshake to complete before the resync packet is sent.

## Known issues / fixes (updated 2026-04-02 session 2)
- bot.placeBlock() still uses mineflayer's 5s blockUpdate timeout internally — use safePlaceBlock() or plantSeeds() instead
- bot.recipesFor() often returns [] when no table passed — use recipesFor() wrapper
- bot.recipesFor(id, null, count, table) returns [] when ingredients < count — always use 1 as minResultCount for recipe detection
- recipesFor('bread') (string name) was returning [] — fixed 2026-04-02: wrapper now resolves string names to numeric IDs via bot.registry.itemsByName
- recipesFor() when no crafting table nearby now logs diagnostic: "3x3 recipes (like bread/bucket) require a crafting table nearby" — fixed 2026-04-02
- craftWithTable() error message when no table nearby now says "Navigate to crafting table first" — fixed 2026-04-02
- bot.activateBlock(dirtBlock) does NOT wait for blockUpdate — use tillLand() to ensure farmland is visible in findBlocks() immediately after
- Agents were calling tillLand via bot.activateBlock then checking findBlocks({matching: farmlandId}) and getting 0 results — root cause: activateBlock resolves immediately (no server ack wait)
- bot.craft(recipe, count, table) called directly fails ~40% with windowOpen timeout — use craftWithTable() instead
- bot.openContainer(chestBlock) called directly fails ~40% with windowOpen timeout — use openChest() instead
- bot.openFurnace(furnaceBlock) called directly fails with windowOpen timeout — use smeltItems() instead (fixed 2026-04-02 with activateBlock pre-open)
- pathfinder "Took to long to decide path to goal!" was occurring even for 15-20 block navigations due to thinkTimeout=10000ms. Fixed 2026-04-02: thinkTimeout raised to 20000ms in bot-core.ts. pathfinderGoto also temporarily doubles thinkTimeout on canDig=true retry.
- pathfinderGoto(goal, 20000) was timing out even for short paths because thinkTimeout=20000ms competed with hardTimeout=20000ms. Fixed 2026-04-02: gotoWithStuckDetection caps thinkTimeout to max(timeoutMs-3000, 5000) so A* finishes BEFORE hard timeout, triggering proper noPath/timeout error and canDig=true retry. GRACE_PERIOD_MS also derived from cappedThinkTimeout.
- path_update status='timeout' ("Took too long to decide path to goal!") was not caught as retriable — fixed 2026-04-02: both status='noPath' and status='timeout' now trigger immediate reject + canDig=true retry in pathfinderGoto.
- windowOpen race: activateBlock was called before registering the windowOpen listener, so on fast servers the event could fire before the listener was attached. Fixed 2026-04-02 in craftWithTable/smeltItems/openChest.
- craftWithTable() was previously passing count as minResultCount to recipesFor() — fixed 2026-04-01 to always use 1
- goals import: uses `import pathfinderPkg from "mineflayer-pathfinder"` (default import) same as bot-core.ts
- bot.combat("cow") does NOT exist — use bot.attack(entity) + collectDrops()
- bot.pillarUp() does NOT exist — use pillarUp() sandbox helper
- bot.build("shelter") does NOT exist — implement manually
- bot.pathfinder.goto() called directly (without pathfinderGoto()) caused 120s deadlock — fixed 2026-04-02: sandbox wraps bot.pathfinder with a Proxy so goto() always goes through gotoWithStuckDetection(goal, 60s). pathfinderGoto() also caps any agent-supplied timeoutMs at 60s (MAX_PATHFINDER_TIMEOUT).
- pathfinderGoto retry previously doubled thinkTimeout before calling gotoWithStuckDetection — removed 2026-04-02 to avoid double-management; gotoWithStuckDetection handles capping internally.
- multiStagePathfind() only called gotoWithStuckDetection(canDig=false) — fixed 2026-04-02 session2: each stage now retries with canDig=true on noPath/timeout (same as pathfinderGoto). Direct close-range gotos also use the same stageGoto helper.
- getMessages() returned duplicate consecutive messages from server spam loops (e.g. repeated gamerule confirmations) — fixed 2026-04-02 session2: deduplicate consecutive identical messages before returning.
- craftWithTable searched for crafting table within 4 blocks; recipesFor within 6 blocks — fixed 2026-04-02 session2: both now use maxDistance=6.
- awareness() did not include AutoSafety periodic scan results (nearbyOres, nearbyChests, nearbyWater) — fixed 2026-04-02 session2: awareness() now appends safetyState scan cache (if fresh < 30s) so agents avoid redundant findBlock calls.
