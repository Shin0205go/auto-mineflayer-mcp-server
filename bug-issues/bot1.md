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

## Previous sessions (Phase 5 - book hunt)
- 5+ deaths trying to access dungeon at (87,35,-62)
- doMobLoot disabled (gamerule shows true now but was disabled before)
- cobweb string collection broken
