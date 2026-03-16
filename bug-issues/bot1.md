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
