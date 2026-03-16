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

## Previous sessions (Phase 5 - book hunt)
- 5+ deaths trying to access dungeon at (87,35,-62)
- doMobLoot disabled (gamerule shows true now but was disabled before)
- cobweb string collection broken
