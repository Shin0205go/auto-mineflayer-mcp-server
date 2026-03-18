## [2026-03-17] Bug: AutoFlee fires when approaching portal (within 3 blocks, HP<=10)

- **Cause**: AutoFlee triggered at HP=7.8 when bot was 2-3 blocks from portal entry point. The portal block suppression only checked if bot was INSIDE portal, but flee was redirecting the pathfinder goal before bot stepped in.
- **Location**: `src/bot-manager/bot-core.ts` — AutoFlee and CreeperFlee handlers
- **Coordinates**: OW ~(-43, 92, 88) near portal at (-46, 93, 87)
- **Last Actions**:
  1. Bot reached destination (-43.7, 92, 88.3) — portal was in reach
  2. Skeleton spawned nearby, HP dropped to 7.8
  3. AutoFlee fired, overriding the portal-entry pathfinder goal
  4. Bot fled away from portal to (-50, 91, 85)
- **Fix Applied**: Extended portal suppression to also check within 3 blocks of portal. If any nether_portal/end_portal within 3 blocks XZ and 2 blocks Y, suppress flee.
- **Fix Location**: `src/bot-manager/bot-core.ts` — AutoFlee and CreeperFlee handlers (commit 71e475a)
- **Status**: Fixed

---

## [2026-03-17] Bug: Death by Pillager in OW (AutoFlee insufficient vs ranged mob)

- **Cause**: Bot navigating near a Pillager Outpost at HP~8 in OW at night. AutoFlee triggered but pillager's ranged arrows continued hitting bot while fleeing. HP went 8→5→2→0.
- **Location**: `src/bot-manager/bot-survival.ts` — AutoFlee logic (flee toward safe direction doesn't clear pillager shots)
- **Coordinates**: OW approximately (-33, 71, 55) near a Pillager Outpost
- **Last Actions**:
  1. Navigating toward portal at (-46, 93, 87) in OW
  2. Path went through forested area near pillager outpost
  3. AutoFlee triggered but ranged mob kept shooting
  4. Death: "Claude1 was shot by Pillager"
- **Fix Applied**: None yet. AutoFlee doesn't help vs ranged mobs at distance
- **Workaround**: After respawn, admin (shng25) had already given HP=20, bot re-entered Nether successfully
- **Status**: Recorded. AutoFlee needs to prioritize cover vs ranged mobs.

---

## [2026-03-17] Bug: Death by fall in Nether (HP=1 with pathfinder going up)

- **Cause**: Bot at HP=1 attempted movement. Pathfinder chose route going UP to Y=116 (soul_sand_valley ceiling area) then fell 24+ blocks. At HP=1 any fall is lethal.
- **Location**: `src/bot-manager/bot-movement.ts` — MoveTo FALL DETECTED logic
- **Coordinates**: Nether ~(16, 88, -24) → died at ~(20, 116, -23) → fall to (20, 92, -23)
- **Last Actions**:
  1. HP=1 from skeleton attack in previous session
  2. Attempted `mc_navigate` to (38, 88, -35) to approach fortress
  3. Pathfinder took bot UP to Y=116 (ceiling), then bot fell
  4. System: "Claude1 fell from a high place"
- **Fix Applied**: The Nether deadlock fix (isDaytime=true in Nether) was applied but not sufficient to prevent this death. Root cause: pathfinder chose upward route at HP=1. The FALL DETECTED at 24 blocks was correct but too late.
- **Positive outcome**: Bot respawned in OW at (156,41,-104) with HP=13.3 and most items retained
- **Status**: Recorded. Need food before returning to Nether.

---

## [2026-03-18] Bug: Starvation deadlock — HP<8 + hunger=0 + no food blocks all movement at night

- **Cause**: At sunset (timeOfDay crossed 12541), `isDaytime` became false. Combined with HP=5 and `hpNow < 8` threshold, movement was blocked. But hunger=0 and no food in inventory means no way to recover HP. Staying in place is also fatal (slower starvation). Result: permanent deadlock.
- **Location**: `src/bot-manager/bot-movement.ts` lines 384-390
- **Coordinates**: OW (168, 59, -7) — forest, no animals within 128 blocks
- **Last Actions**:
  1. Area hunted out, hunger=0, HP=5
  2. Actions 1-7: navigate checks, all entity searches returned empty
  3. Action 8: navigate to (200,64,200) blocked by safety guard (tick had crossed 12541)
- **Fix Applied**: Added starvation-deadlock exception: when hunger=0 AND no food in inventory AND no hostile mobs nearby, movement is allowed at HP≥2 even at night. Rationale: staying put guarantees death; moving to find food is the only survival path.
- **Status**: Fixed

---

## [2026-03-17] Bug: Nether movement deadlock — isDaytime always false in Nether

- **Cause**: `bot.time.timeOfDay` in Nether dimension is always 0, and since `isDaytime = timeOfDay < 12541` resolves to `true` (0 < 12541), BUT the dimension check is separate. After investigation: ネザーでは敵mob（wither_skeleton）が存在し`hasHostileNearby`がtrueになり、HP=2で距離>30の移動がブロックされた。
- **Location**: `src/bot-manager/bot-movement.ts` line 331-337
- **Coordinates**: Nether (20, 85, -22)
- **Last Actions**:
  1. Navigating from (-12,110,2) to (100,50,-70) in Nether
  2. Skeleton encountered and attacked bot to HP=2
  3. mc_navigate blocked due to HP<8 + hostile nearby (night check)
  4. No food = cannot heal = permanent deadlock
- **Fix Applied**: Added Nether/End dimension detection. In Nether/End, `isDaytime=true` always (no day/night cycle). Also: hasHostileNearby check did NOT include wither_skeleton/blaze/ghast for Nether mobs. Net effect: `isDaytime=true` in Nether unlocks the looser HP≥2 threshold.
- **Fix Location**: `src/bot-manager/bot-movement.ts` — added `isNetherOrEnd` variable, set `isDaytime = isNetherOrEnd || timeOfDay < 12541`
- **Status**: Fixed (commit pending)

---

## [2026-03-16] Bug: Death by Zombie during dungeon navigation

- **Cause**: Bot navigated underground (y=-7) toward dungeon surface (87,60,-62) and encountered a Zombie
- **Location**: Around (83,-7,-61) - underground cave system
- **Coordinates**: (83, -7, -61) approximate death location
- **Last Actions**: 
  1. Started at (55,-16,-28) underground
  2. Navigated toward dungeon surface (87,60,-62) with canDig=true
  3. Bot dug through cave wall and encountered Zombie
  4. "Claude1 was slain by Zombie"
- **Fix Applied**: None yet. Underlying issue: pathfinder digs through walls without checking for hostiles behind them
- **Status**: Investigating

---

## [2026-03-16] Bug: Post-death script continuation causes incorrect navigation

- **Cause**: After death, bot respawned at (-7,118,2) but script continued trying to reach dungeon from wrong position
- **Location**: dungeon_torch_strategy.mjs - `died` flag not stopping navigation loop
- **Fix Applied**: The `died=true` flag was set but navTo() continued because `arrived=false` and `noPath=false` causes timeout wait, then continues regardless
- **Status**: Investigating. The navTo() function checks `!died` but loop continues after pathfinder.stop()

---

## [2026-03-16] Bug: Item drops (string from cobweb) not being collected

- **Cause**: bot.dig() causes item to drop but bot doesn't auto-collect. GoalNear(x,y,z,0) doesn't force pickup
- **Location**: tmp_scripts/collect_string.mjs - item collection after cobweb dig
- **Details**: 
  - itemDrop event fires, entity spawns with e.name === 'item'
  - GoalFollow(item, 0) doesn't successfully collect
  - Manual forward+jump movement doesn't work
- **Status**: Needs proper collection mechanism (collectBlock plugin or similar)

---

## [2026-03-16] Bug: Death from fishing at base - fell off platform

- **Cause**: fish_horizontal.mjs navigated to "water stand" position (14,100,9) which is actually on the edge of the base platform, bot fell to y=92 and died
- **Location**: tmp_scripts/fish_horizontal.mjs
- **Coordinates**: ~(14,100,9) - fell off base edge
- **Fix**: Base area water is NOT suitable for fishing - need outdoor/natural water
- **Status**: Recorded

---

## [2026-03-16] Bug: Death from HP=4.5/Food=0 - no survival check in script

- **Cause**: fish_for_book.mjs started with HP=4.5, Food=0. Script navigated toward mineshaft (y=-10) without checking survival first. Bot died during navigation.
- **Location**: tmp_scripts/fish_for_book.mjs - missing HP/food safety check at startup
- **Coordinates**: ~(68, -10, -39) death during navigation to mineshaft
- **Last Actions**:
  1. Started at (3.5, 67, 49.3) with HP=4.5, Food=0
  2. Navigated to chest (9,96,4) - dist 20.1 but chest open failed (inv full, empty slots=0)
  3. Navigated toward cobweb at (68,-10,-39) with HP still critical
  4. "BOT DIED!" during underground navigation
- **Fix Needed**: All scripts must check HP/food at startup and abort if HP < 6 or food = 0
- **Fix Applied**: None - standalone script issue
- **Status**: Recorded

---

## [2026-03-16] Bug: Death from HP=2.17/Food=2 during navigation back to base

- **Cause**: craft_book_final.mjs started with HP=2.17, Food=2 after cow hunt. `bot.consume()` timed out. Bot died during long-distance navigation from (-78,91,213) to base.
- **Location**: tmp_scripts/craft_book_final.mjs - EPIPE error = bot death during nav
- **Coordinates**: (~-78,91,213) → death somewhere between there and base
- **Last Actions**:
  1. hunt_animals.mjs found cow at (-94,97,181), killed it, got leather x1
  2. craft_book_final.mjs started at HP=2.17, Food=2
  3. `bot.consume()` timed out (food not consumed)
  4. Bot navigated toward base with HP=2.17 and died
- **Fix Applied**: survival_and_craft.mjs improved eat logic using activateItem() loop
- **Note**: keepInventory=true confirmed - bot respawned with HP=20, Food=20, all items intact
- **Status**: Recorded (keepInventory saved progress)

---

## [2026-03-16] Bug: Death during portal lighting attempt at (-44,93,88)

- **Cause**: Bot died at y=93 while attempting to activate portal frame. Frame was incomplete (top row 2/4). Likely fell off incomplete frame or void below portal site.
- **Location**: complete_and_light_portal.mjs
- **Coordinates**: Died near (-44,93,88), respawned at (1,92,-1)
- **Last Actions**:
  1. Placed bottom row of portal at (-47 to -44, y=92, z=87)
  2. Attempted to light with flint_and_steel activateBlock()
  3. Portal not valid (top row incomplete), bot apparently fell off the structure
- **Fix Needed**: Complete the top row before attempting to light. Also ensure bot stands safely at portal base level, not elevated.
- **Status**: Recorded (keepInventory=true, items intact)

---

## [2026-03-16] Bug: Bot death in Nether (HP→0.5) during dig_tunnel_up script

- **Cause**: dig_tunnel_up.mjs started with HP=2.5 (inherited from pillar_v2 failure). Script checked `bot.health <= 2` but bot had HP=0.5 at the time of stopping. Bot may have taken mob damage.
- **Location**: tmp_scripts/dig_tunnel_up.mjs
- **Coordinates**: ~(-12, 82-98, 3) in the_nether
- **Last Actions**:
  1. pillar_v2.mjs failed to pillar (0 blocks gain), ended at y=83 with HP=2.5
  2. dig_tunnel_up.mjs started with HP=2.5
  3. Bot navigated to (-12,98,3), touching portal block at y=98
  4. HP critical message: 0.5, stopped climbing
  5. Portal teleport happened: bot went from the_nether to overworld (11,109,-7) with HP=20 Food=20
- **Note**: HP reset to 20 after teleport confirms this was a death+respawn through keepInventory
- **Fix Needed**: Scripts must abort when HP < 5 in Nether (mob damage risk is high)
- **Status**: Recorded (keepInventory=true, items intact after respawn)

---

## [2026-03-16] Nether Fortress Search - Server Down

- **Status**: Minecraft server (port 25565) is DOWN as of 17:50
- **Last Known Bot Position**: (~-3,54,-40) in the_nether, HP=10, Food=0
- **Previous exploration**: Covered x=-200 to x=200, z=-200 to z=200 without finding nether_bricks
- **Fortress location**: Unknown. Need to search further (+300, +400 blocks from spawn)
- **Note**: Pathfinder frequently fails in Nether due to complex terrain (lava, soul sand valleys)
- **Action Required**: User must restart Minecraft server. Then resume fortress search.

---

## [2026-03-16] Bug: Death in Nether - lava while navigating to fortress (Session 177)

- **Cause**: Bot fell into lava while navigating toward nether_bricks at (214, 25, -134). HP was already at 4.0 before lava contact, causing immediate death.
- **Location**: Nether, around (129.6, 25.8, -42.2) → lava fall
- **Coordinates**: Death near (130, 26, -42) in the_nether
- **Last Actions**:
  1. Bot found nether_bricks target at (214, 25, -134) during 200-block scan
  2. Was navigating toward it from (129, 26, -42) with HP=4.0 (already critical!)
  3. Fell into lava during navigation
  4. Auto-respawned to overworld
- **Root Cause**:
  1. No food in inventory → HP slowly drained from hunger
  2. Navigation proceeded even with HP=4.0 (too low)
  3. Nether terrain is dangerous - lava everywhere
- **Fix Needed**:
  1. Safety check: abort nether navigation when HP < 8
  2. Food required before Nether entry
- **Fix Applied**: None yet (keepInventory=true, items intact)
- **Status**: Recorded. Fortress at (214, 25, -134) CONFIRMED.

---

## [2026-03-16] Bug: Death from Skeleton+Enderman at night with HP=4.5 (Session 177)

- **Cause**: Script started with HP=4.5, food(hunger)=16. Script checked `bot.food < 10` which was FALSE (16 >= 10), so skipped `mc_eat`. Then immediately tried to navigate 49.5 blocks at night. Skeleton+Enderman attacked bot, HP dropped to 2.5. Then `mc_navigate` blocked with SAFETY (HP=2.5 < 3), but bot continued due to respawn in wrong place.
- **Location**: Near (-3.5, 61, 13.9) in overworld, nighttime
- **Coordinates**: Death near (-3.5, 61, 13.9) overworld
- **Last Actions**:
  1. Connected with HP=4.5, food=16
  2. Script skipped `mc_eat` because hunger=16 (condition was food < 10)
  3. Navigated 49.5 blocks at night — Skeleton attacked immediately
  4. AutoFlee triggered but HP kept dropping
  5. Fell from height, died from fall damage
- **Root Causes**:
  1. Script bug: should check HP < 12, not just food < 10 — hungry meter ok but HP was critical
  2. Code bug: `bot-movement.ts` only blocked at HP < 3 at night — should block at HP < 8
- **Fix Applied**:
  1. `bot-movement.ts`: Raised night-hostile threshold from HP < 3 to HP < 8 for movement blocks
  2. `bot-movement.ts`: Added auto-eat logic before 30+ block moves when HP < 14 and food available
  3. Committed with `npm run build`
- **Status**: Fixed

---

## Previous sessions (Phase 5 - book hunt)
- 5+ deaths trying to access dungeon at (87,35,-62)
- doMobLoot disabled (gamerule shows true now but was disabled before)
- cobweb string collection broken

## [2026-03-16] Bug: entity.mobType deprecated warning in fight()
- **Cause**: bot-survival.ts uses `e.mobType?.toLowerCase()` which is deprecated in prismarine-entity
- **Location**: `dist/bot-manager/bot-survival.js:584`
- **Coordinates**: (40, 109, 63) birch_forest
- **Last Actions**: `mc_combat('cow', 8)` - hunting for food
- **Fix Applied**: None yet (warning only, not breaking)
- **Status**: Low priority - need to change `e.mobType` to `e.displayName`

## [2026-03-16] Observation: No animals found nearby for food
- **Cause**: Area around (40, 109, 63) has no passive mobs (biome may be depopulated)
- **Location**: birch_forest biome
- **Coordinates**: (40, 109, 63)
- **Last Actions**: mc_combat targeting cow/pig/sheep - all returned "No X found nearby"
- **Fix Applied**: Need to explore wider area or use /locate village
- **Status**: Gameplay issue, not code bug

## [2026-03-16] Death: Killed by Zombified Piglin near Nether portal
- **Cause**: mc_combat('pig', 6) found no pig but zombified_piglin nearby.
  fight() targeted zombified_piglin instead of passive mob.
  HP was already at 8.2 before fight started - too dangerous.
- **Location**: `dist/bot-manager/bot-survival.js` fight() function
- **Coordinates**: (-43.5, 92, 88.5) near Nether portal
- **Last Actions**: mc_combat('pig', 6) → fight() matched zombified_piglin (not pig)
- **Fix Applied**: flee_at_hp=6 was too low given HP=8.2 starting; need to check HP before combat
- **Status**: Fixed by avoiding combat when HP < 10

## Root Cause Analysis
The bug: fight() with target="pig" found zombified_piglin nearby portal and attacked.
When HP=8.2 and flee_at_hp=6, bot fought 3 zombified piglins and died at HP=3.2.
The fight function matches entity displayName/name containing "pig" which matches "zombified_piglin".

## Fix Needed
In bot-survival.ts fight(), when searching by target name:
- Should NOT match "zombified_piglin" when searching for "pig"
- Need exact/suffix matching, not substring matching

---

## [2026-03-16] Bug: Death in Nether by lava during mc_navigate (Session 178)

- **Cause**: mc_navigate to fortress (214,25,-134) used emergency dig-through after fall_detected.
  The dig-through direction led into a lava pool. Bot fell 14.8 blocks at (153,33,-96).
  AutoFlee triggered but HP drained HP=12.2→8.2→4.2→0.2 in lava.
- **Location**: bot-movement.ts - `emergency dig-through` after fall_detected does NOT check for lava
- **Coordinates**: Death at ~(153, 33, -96) in the_nether
- **Last Actions**:
  1. mc_navigate(x=214, y=25, z=-134) from Nether portal exit (-12, 110, 2)
  2. Multiple fall_detected events as bot descended through Nether terrain
  3. Emergency dig-through activated, dug soul_sand downward into lava
  4. "Claude1 tried to swim in lava" - death
- **Root Causes**:
  1. Emergency dig-through doesn't check if destination block is lava/fire before digging
  2. Nether navigation is inherently dangerous with uncontrolled descent
  3. No lava detection in safety threshold during navigation
- **Fix Applied**: None yet - need to add lava check before emergency dig and during pathfinding
- **Status**: Investigating

---

## [2026-03-16] Bug: mc_combat object argument causes toLowerCase error (Session 178)

- **Cause**: Script called mc_combat({target:'blaze', flee_at_hp:8, collect_items:true}).
  mc_combat signature is mc_combat(target?: string, fleeAtHp?: number).
  Object was passed as `target`, causing entityName.toLowerCase() crash in fight().
- **Location**: src/tools/core-tools.ts mc_combat function
- **Fix Applied**: Need to add object argument unpacking in mc_combat, or update signature
- **Status**: Script fixed (calling with positional args now); core-tools should be hardened

---

## [2026-03-17] Bug: mc_store object argument not supported (Session 179b)

- **Cause**: Script called mc_store({ action: 'list', x: 9, y: 96, z: 4 }).
  mc_store signature is mc_store(action, itemName?, count?, chestX?, chestY?, chestZ?).
  Object arg was passed as `action`, causing `Unknown action: [object Object]`.
- **Location**: src/tools/core-tools.ts mc_store function
- **Coordinates**: (9, 96, 4) chest location
- **Fix Applied**: Script fixed to use positional args: mc_store('list', undefined, undefined, 9, 96, 4)
- **Status**: Script fixed; core-tools should add object argument support for consistency

---

## [2026-03-17] Critical: HP=3, Hunger=0, No food, Night (Session 179c)

- **Cause**: Bot respawned after Nether lava death with HP=5. Then during navigation to chest,
  pathfinder dug through cobbled_deepslate (draining further time/health), zombie/creeper
  damaged bot at night, hunger drained to 0. HP dropped to 3.
- **Location**: Overworld (7, 89, 9), birch_forest, midnight
- **Last Actions**:
  1. Connected with HP=5, Hunger=13
  2. Tried to navigate to chest (9,96,4) - dug through cobbled_deepslate unnecessarily
  3. Night time: zombie+creeper attacked (AutoFlee triggered but HP still dropped)
  4. Hunger dropped to 0, HP now 3
- **Chest Contents**: cobblestone, clay_ball, coal, netherrack, soul_sand, obsidian - NO FOOD
- **Root Causes**:
  1. doMobLoot disabled - cannot get food from animals
  2. No food in chest
  3. Night navigation with critical HP
- **Admin Required**: /gamerule doMobLoot true + /give Claude1 cooked_beef 16
- **Status**: Awaiting admin action. Bot alive at (7,88,9) HP=3.

Additional finding: All passive mobs (cow/sheep/pig/chicken) "not found nearby" within 64 blocks
of current position (-5, 95, 0). Area is depopulated. Even if doMobLoot was enabled, no mobs to hunt.
Bot needs to explore further (200+ blocks) to find animals.

---

## [2026-03-17] Gameplay Blocker: HP=3, No Food, No Mobs (Session 179c-d)

- **State**: HP=3, Hunger=0, Position (-5, 95, 0) overworld morning
- **Phase**: 6 (Nether), need 7 blaze_rods, have 12 ender_pearls
- **Blockers**:
  1. No food in inventory
  2. No food in chest (chest has only materials)
  3. No passive mobs within 64 blocks of current position
  4. doMobLoot status unknown (may or may not be disabled)
  5. HP=3 makes exploration dangerous (hunger damage will kill)
- **Admin Actions Required**:
  ```
  /gamerule doMobLoot true
  /gamerule doEntityDrops true
  /give Claude1 cooked_beef 16
  ```
  OR restart bot at full HP with food available
- **Next Session**: After admin gives food, navigate to portal at (-45,93,87), enter Nether,
  navigate to fortress at (214,25,-134), hunt blazes.
- **Status**: RESOLVED - bot was shot by skeleton and respawned with HP=20, Hunger=20

---

## [2026-03-17] Death: Shot by Skeleton (Session 179 report wait)

- **Cause**: Bot was waiting for admin with HP=3, Hunger=0. AutoFlee triggered from skeleton
  but HP=3 was too low to survive skeleton arrow. Bot died.
- **Location**: Overworld near position (-24, 93, -5)
- **Coordinates**: ~(-24, 93, -5) overworld
- **Last Actions**:
  1. Waiting for admin response loop (10s intervals)
  2. AutoFlee triggered from skeleton
  3. HP=3 not enough to survive arrow damage
  4. "Claude1 was shot by Skeleton"
- **Outcome**: Respawned with HP=20, Hunger=20 (keepInventory=true, all items intact)
- **Root Cause**: AutoFlee with HP=3 cannot guarantee survival (skeleton damage > remaining HP)
- **Fix Needed**: When HP <= 5, bot should hide indoors or dig into ground instead of fleeing
- **Status**: Survived (keepInventory). Items intact including ender_pearl x12. Ready to continue.

---

## [2026-03-17] Critical: Nether Portal (Nether->OW) Not Working (Session 184)

- **Cause**: Bot at (-12,110,2) in soul_sand_valley (Nether) cannot use nether_portal to return to OW.
  Portal stands at (-12-13, 110-112, 2) with axis=x. Bot enters portal block, stands still for 30s,
  but server never sends dimension change / spawn event.
- **Location**: Nether portal at (-12,110,2) in the_nether
- **Coordinates**: (-12, 110, 2) in the_nether
- **Last Actions**:
  1. Sessions 180-184: Bot repeatedly tried portal at (-12,110,2) - all timeout after 30s
  2. Portal detection works (6 nether_portal blocks found at that location)
  3. Bot enters portal, clears controls, waits - no teleport
- **Code Bug Fixed**: bot-movement.ts shouldSkip logic was preventing enterPortal() when
  bot was in Nether + targeting nether_portal (commit 6c2b56c). This is now fixed.
- **Remaining Issue**: Even with code fixed, server not triggering portal teleport.
  Possible server-side causes:
  1. Portal cooldown (but bot has been in Nether for 10+ sessions - cooldown should be gone)
  2. Server has disabled portal travel via spigot/paper config
  3. OW side portal was broken/removed
  4. `allowNether=false` in server.properties
- **Admin Actions Required**:
  1. Check: is the OW Nether portal at (-47 to -44, y=92-96, z=87) still active?
  2. Check server.properties: `allow-nether=true`
  3. Try: `/tp Claude1 -45 93 87` to force OW teleport
  4. Or: `/give Claude1 cooked_beef 16` so bot can survive in Nether for blaze hunt
- **Bot State**: HP=5, Hunger=4, Pos=(-12,110,2) in soul_sand_valley
- **Status**: BLOCKED. Admin intervention required.

---

## [2026-03-17] Bug: Death by Skeleton in Nether near portal spawn (HP=1, no food)

- **Cause**: Bot entered Nether at HP=1 Hunger=0 (no food due to doMobLoot disabled). Skeleton spawned near portal spawn at (-12, 110, 3). AutoFlee triggered but HP was already critical. "Claude1 went up in flames" = fire damage (may have been knocked into lava/fire).
- **Location**: `src/bot-manager/bot-core.ts` — AutoFlee during portal entry suppressed, but death still occurred from skeleton AFTER portal entry
- **Coordinates**: Nether ~(-12, 110, 3) (portal spawn area)
- **Last Actions**:
  1. Entered Nether via portal at (-46, 93, 87) OW
  2. Respawned in Nether at (-12, 110, 3) with HP=1
  3. Skeleton hit, HP→0, "went up in flames"
- **Fix Applied**: Session 186 - AutoFlee suppressed during portal entry (bot-core.ts commit 6379575). But survival after portal entry at HP=1 remains issue.
- **Root Cause**: No food available (doMobLoot disabled), starvation reduces HP to 1 before portal entry, making bot trivially killable.
- **Status**: Need admin food before Nether entry at low HP.

---

## [2026-03-17] Bug: Death from fall damage at 0.5 HP while navigating to portal (Session current)

- **Cause**: Hunger depleted to 0 during navigation from (32,95,-73) to portal (-45,93,87). HP drained to 0.5 from starvation. mc_navigate to portal caused fall damage ("hit the ground too hard") which killed bot at 0.5 HP.
- **Location**: OW navigation path near portal coordinates (-45, 93, 87)
- **Coordinates**: Death near (-43.5, 92.0, 88.5)
- **Last Actions**:
  1. Started Phase 6 at (32,95,-73) with HP=20, hunger=20
  2. Crafted and equipped full gold armor
  3. Hunger dropped to 0, HP to 0.5 during travel (no food in inventory)
  4. mc_navigate to portal caused "Claude1 hit the ground too hard" - death
- **Root Cause**: No food in inventory. Area is depopulated of passive mobs (over-hunted in previous sessions). Bot traveled ~100 blocks with hunger=0 → HP drained to 0.5 → any fall fatal.
- **Outcome**: Respawned HP=20, Hunger=20, armor retained (keepInventory=true)
- **Fix Needed**: mc_navigate should abort/warn when HP < 5 or hunger = 0 before long distances
- **Status**: Recorded. Continuing Phase 6 with full HP after respawn.

---

## [2026-03-17] Bug: Death by lava in Nether navigation (pathfinder routes over lava lakes)

- **Cause**: `checkGroundBelow()` treated lava blocks as solid ground, allowing sub-step navigation to waypoints above lava lakes. Pathfinder would route bot over lava lake edge and bot would fall into lava.
- **Location**: `src/bot-manager/minecraft-utils.ts:checkGroundBelow()` and `src/bot-manager/bot-movement.ts`
- **Coordinates**: Nether ~(70, 72, -49) — fell into lava lake between T1 and T2
- **Last Actions**:
  1. Navigating from T1 (24, 87, -19) toward T2 (131, 47, -90) 
  2. Sub-step waypoint at ~(68, 78, -46) was over a lava lake
  3. FALL DETECTED stopped pathfinder but bot had already started falling
  4. "Claude1 tried to swim in lava"
- **Fix Applied**: 
  1. `checkGroundBelow()` returns `hasLavaBelow=true` when lava found below destination
  2. `moveTo()` aborts immediately when `hasLavaBelow=true` with descriptive error
  3. Commit: 1816582
- **Status**: Fixed. Navigation will now abort instead of routing over lava lakes.

---

## [2026-03-18] Death: Slain by Zombie at night with HP=5, Hunger=0 (Session current)

- **Cause**: HP=5 from starvation, hunger=0, no food. Night time. Bot wandered to find animals, zombie spawned and killed bot.
- **Location**: OW (~151, 63, 4) old_growth_birch_forest
- **Coordinates**: ~(151, 63, 4)
- **Last Actions**:
  1. HP=5 from starvation (hunger=0 stops damage at 0.5 hearts on Normal)
  2. Searched cow/sheep/pig/chicken/rabbit all "not found" within 512 blocks
  3. Tried mc_combat(zombie) to get rotten flesh — zombie defeated but no drops (doEntityDrops disabled)
  4. Night fell, zombie spawned and killed bot
- **Outcome**: Respawned HP=19, Hunger=20 (keepInventory=true). All items intact.
- **Root Cause**: doEntityDrops disabled — zombie dropped nothing. No passive mobs in area to hunt.
- **Status**: Survived (keepInventory). Continuing.

---

## [2026-03-18] Death: Slain by Zombie during cave navigation (HP=5, hunger=0)

- **Cause**: mc_navigate to chest at (276,54,36) routed through cave system. HP=5, hunger=0, midnight. Zombie in cave killed bot. Chat showed "Claude1 was slain by Zombie".
- **Location**: OW cave ~(98, 61, 14) — pathfinder entered cave from surface
- **Coordinates**: ~(98, 61, 14)
- **Last Actions**:
  1. HP=5, hunger=0, no food, no animals within 200 blocks
  2. Tried to navigate to surface chest at (276,54,36) to find food
  3. Pathfinder routed through cave/underground at night
  4. Zombie in cave killed bot at HP=5
- **Root Cause**: mc_navigate with HP=5 at midnight routed underground where hostile mobs spawn
- **Fix Needed**: mc_navigate should avoid underground routing when HP < 8 at night
- **Status**: Survived (keepInventory). Respawned.

---

## [2026-03-18] Death: Lava during navigation at night (HP=4, hunger=0, safety guard stale)

- **Cause**: Safety guard in bot-movement.ts read stale HP=4 (from previous body), blocked mc_navigate. Meanwhile bot actually died again from lava (likely pathfinder still running from previous mc_navigate call). Chat: "Claude1 tried to swim in lava".
- **Coordinates**: ~(95, 61, 13) → fell into lava somewhere underground
- **Last Actions**:
  1. mc_status showed HP=12, hunger=13
  2. mc_navigate to (276,54,36) — safety guard blocked with "HP=4.0 at night"
  3. Bot apparently still moving from a prior navigate call, hit lava
  4. Respawned at (-8.5, 111, 2.7) — base area with HP=20, Hunger=20
- **Root Cause**: Safety guard reading stale HP from bot object during async operation
- **Status**: Survived (keepInventory). Now at base with full HP/hunger.

---

## [2026-03-18] Death: Slain by Zombie while dropping inventory junk (HP=20 → 0)

- **Cause**: Bot was standing still at (10, 92, 9) dropping/picking up items in a loop. A zombie killed the bot. No armor equipped. Bot was distracted by inventory management loop.
- **Coordinates**: ~(10, 92, 9) overworld, daytime
- **Last Actions**:
  1. Attempting to drop junk (dirt x370, diorite, andesite, etc.) via mc_drop
  2. Bot standing still re-picking up dropped items (vanilla item pickup)
  3. Tried deposit_all_except to chest at (9,96,4) — GoalChanged errors (chest unreachable, 4 blocks up)
  4. Placed new chest at (12,92,6) — chest open timeout errors
  5. "Claude1 was slain by Zombie"
- **Root Cause 1**: mc_drop drops items at bot feet → bot immediately re-picks up (vanilla behavior). Need to move away before re-picking or use different disposal strategy.
- **Root Cause 2**: Chest at (9,96,4) is 4 blocks above current position — pathfinder can't reach it.
- **Root Cause 3**: Freshly placed chest at (12,92,6) caused "Chest open timeout" — possible server sync issue with newly placed chests.
- **Root Cause 4**: No armor equipped during this entire session — zombie killed bot in 1-2 hits.
- **Outcome**: Respawned with keepInventory=true. All items intact.
- **Fix Needed**:
  1. After respawn, immediately equip armor before any inventory management
  2. Use mc_craft bread immediately (have 4 wheat) then eat before doing anything else
  3. For junk disposal: navigate to main chest properly or drop and sprint away immediately
- **Status**: Recorded. Continuing.

---

## [2026-03-18] Critical: HP=5, Hunger=0, No Food — Phase 6 Blocked (Session current)

- **Cause**: doMobLoot still disabled on server. No food obtainable from any mob kills.
  Starvation reduced HP to 5 (stable — Normal difficulty stops at 0.5 hearts).
- **Location**: OW (152, 60, -22) near base crafting_table (153, 60, -21)
- **Coordinates**: (152, 60, -22)
- **Last Actions**:
  1. Connected with HP=20, Hunger=11, gold full armor, ender_pearl x12
  2. Searched for animals: cow/sheep/pig/chicken/rabbit all "not found" within 256 blocks
  3. Killed 2 salmon — 0 food drops (doEntityDrops still disabled)
  4. Killed 1 drowned — 0 drops
  5. Fell underground (y=29) during navigation, climbed back to surface y=60
  6. HP drained to 5 from starvation during underground navigation
- **Blockers**:
  1. doMobLoot disabled → no mob loot of any kind (food, blaze rods)
  2. No passive mobs within 256 blocks (area depopulated)
  3. No plant-based food (no sweet_berry_bush, mushrooms within 128 blocks)
  4. Phase 6 blaze_rod farming impossible without doMobLoot
- **Admin Actions Required**:
  ```
  /gamerule doMobLoot true
  /gamerule doEntityDrops true
  /give Claude1 cooked_beef 16
  ```
- **Bot State**: HP=5, Hunger=0, Position=(152, 60, -22), gold armor + iron_sword + ender_pearl x12
- **Status**: BLOCKED. Awaiting admin action.
