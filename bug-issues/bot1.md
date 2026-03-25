## [2026-03-25] Bug: Session 67 - Bot stuck on pillar at Y=75 surrounded by mobs, all movement blocked, Hunger=0 starvation

- **Cause**: Bot pillarUp'd to Y=75 (birch_forest) to escape night mobs, but mobs persisted into daytime. drowned kept triggering wait() abort, preventing movement. moveTo() returns instantly without movement when mobs nearby.
- **Coordinates**: (12, 75, -7)
- **Last Actions**: pillarUp(10) → wait(20000) aborted by drowned → combat(drowned) failed to kill → moveTo(210, 72, 193) returned instantly without movement
- **Error Message**: moveTo returns in <1s with no position change. wait() aborted repeatedly by drowned at 7-8 blocks.
- **State**: HP=9.3, Hunger=0, 15 mobs nearby (enderman:1, zombie:3, creeper:3, skeleton:2, drowned:1, bat:2)
- **Root Cause Hypothesis**: moveTo() is being blocked by mob safety checks (creeper x3 + skeleton x2 nearby). Bot is stuck because: 1) can't move due to mob checks, 2) can't eat (no food), 3) can't combat (drops not registering), 4) pillarUp is the only working API but barely.
- **Bug Pattern**: Same as Session 66 - mob cluster + movement block = total immobility. Starvation death likely.
- **Impact**: Bot will die from hunger in ~5 minutes without intervention.
- **Root Cause Analysis** (code review):
  1. `post-pillar descent race condition` (bot-movement.ts): The descent interval checked `!bot.pathfinder.isMoving()` at 300ms after setGoal(). Pathfinder needs 500-1500ms to compute a path from pillar top. isMoving() was false at the first check → interval exited with 0 movement → bot stayed stuck on pillar. The previous fix from commit 73caabd added the descent code but introduced this subtle race condition.
  2. `wait() missing vertical clearance` (mc-execute.ts): midWaitClosestDist used 3D distance. Drowned at Y=68 with bot at Y=75 = 7 blocks 3D distance, triggering abort every 500ms even though the drowned cannot melee the bot on the pillar. Same problem as moveTo's melee check, but wait() had no vertical exception.
- **Fix Applied** (commit b0eddfc):
  1. `pillarUp() post-descent`: Added `descentElapsed > 2000` guard before using `!isMoving()` as exit condition (same pattern as flee()'s elapsed > 2000). Also added `flee(20)` as fallback when pathfinder descent moves < 1 block — flee's multi-retry/elevated-terrain logic handles pillar tops better than raw setGoal().
  2. `wait() hostile check`: Added `vertOffset >= 4` skip for mobs ≥4 blocks below the bot (same exception as moveTo check B2). Prevents repeated abort loops when bot is safely elevated on a pillar.
- **Status**: Fixed.

## [2026-03-25] Bug: Session 67 - combat() not yielding drops

- **Cause**: bot.combat() for cow/pig/chicken/sheep returns success but no food drops appear in inventory
- **Coordinates**: (12, 72, -7)
- **Last Actions**: navigate(cow) → combat(cow) → inventory check shows no raw_beef/cooked_beef
- **Error Message**: No error thrown, but inventory unchanged after combat
- **Status**: Reported

## [2026-03-25] Bug: Session 66 - Bot completely stuck at Y=56, all movement/combat APIs non-functional

- **Cause**: All navigation/escape APIs failing silently. moveTo(), flee(), pillarUp(), combat() all return instantly without movement or effect.
- **Coordinates**: (-1, 56, 2)
- **Last Actions**: Attempted moveTo(100,65,100), pillarUp(10), flee(50), combat("skeleton") - all failed without error, bot stays at same position Y=56
- **Symptoms**:
  - moveTo() returns in 3 seconds without movement
  - flee() returns in 56 seconds without movement
  - pillarUp() returns in 50 seconds without Y change
  - combat() returns instantly, no entity kills, skeleton count unchanged
  - wait() aborted immediately by "skeleton at 0.4 blocks"
  - arrow x20 in nearbyEntities shows bot is being shot continuously
- **Environment**: Y=56 (underground), surrounded by skeleton x3, zombie x2, creeper x4, drowned x1
- **HP**: 15.5, Hunger: 14
- **Impact**: Bot cannot escape, cannot fight, cannot farm. Completely immobilized.
- **Root Cause Hypothesis**: Bot may be in a cave/enclosed space blocking pathfinder. Skeletons preventing all wait() calls. Possible pathfinder deadlock similar to Session 65 bug.
- **Root Cause Analysis** (code review):
  - `combat()`: Hard REFUSED because `creeper x4` within 8 blocks (per-spec REFUSED, intentional)
  - `moveTo()`: ranged_mob_danger fires at 500ms for skeleton at 0.4 blocks (armorCount<=2, skeleton within 16 blocks). Aborts every call.
  - `flee()`: `canDig=false` means pathfinder cannot route through stone cave walls at Y=56. Pathfinder finds no path. All direction retries also fail (canDig=false).
  - `pillarUp()`: Hits 5s dig timeouts on thick cave ceiling (4+ solid blocks above). Burns the 45s global timeout without any Y gain.
- **Fix Applied** (commit after 0ccb7e4):
  1. `pillarUp()`: Underground (Y<65) + 4+ solid blocks above → immediately delegate to `emergencyDigUp()` instead of slow jump-place loop
  2. `flee()`: Underground (Y<65) → enable `canDig=true` for initial pathfinding AND directional retries, so pathfinder can dig through cave walls
  3. `flee()`: After all retries fail (moved <5 blocks) AND underground → call `emergencyDigUp()` as last resort
- **Status**: Fixed.

---

## [2026-03-25] Bug: Death by Skeleton (HP=2 from Hunger=0 starvation) - Session 65 death #2

- **Cause**: HP=2 from hunger damage (Hunger=0 for extended period). While moving (Z-direction exploration), skeleton shot bot. "Claude1 was shot by Skeleton". HP too low to survive one arrow.
- **Coordinates**: (-3, 50, 20) approx
- **Last Actions**: moveTo() Z-direction exploration → skeleton attack at HP=2
- **Root Cause**: Hunger=0 reduced HP to dangerous level. Combined with hostile mob encounter, resulted in death. No food available to recover.
- **Contributing factors**: moveTo non-functional prevented escape from spawn area; gather() timeouts prevented wood/food collection; no animals near spawn.
- **Status**: Reported. Session 65. Death #2.

---

## [2026-03-25] Bug: moveTo() non-functional near spawn (-10,82,13) - Session 65 CRITICAL

- **Cause**: bot.moveTo(x, y, z) called with coordinates far away (200m+). Bot stays at (-10, 82, 13). moveTo(200,82,0), moveTo(0,82,0), moveTo(-100,82,-100) all leave bot at same position. Short moves (< 5 blocks) show tiny movement.
- **Coordinates**: (-10, 82, 13)
- **Symptoms**: gather() timeouts (can't reach target), navigate() immediate return without movement, pillarUp() timeout or no Y change, bot stuck near (-10, 82, 13)
- **Root Cause**: Pathfinder fails silently - no path found from current position, moveTo returns without error or movement. Possibly terrain around spawn blocks all paths.
- **Impact**: Bot cannot gather food, wood, or escape night hostiles. HP=10, Hunger=0, stuck.
- **Fix Needed**: moveTo should throw error if no path found. Debug pathfinder from (-10, 82, 13).
- **Status**: Reported. Session 65. CRITICAL BLOCKING.

---

## [2026-03-25] Bug: Bot drowned at Y=46 underground (water pocket) - Session 65 death

- **Cause**: Bot was stuck at Y=46 underground. dig(px, py+10, pz) failed with "Digging aborted" (hit water block). Bot was in or near an underground water pocket. Server: "Claude1 drowned".
- **Coordinates**: (6, 46, 3)
- **Last Actions**: Sequential bot.dig from Y+1 to Y+9 succeeded, then Y+10 failed with "Digging aborted" (water). Bot drowned in water pocket.
- **Error**: "[Server] Claude1 drowned"
- **Root Cause**: Underground water pocket at Y=56 area. bot.dig hit water block, water flowed into bot's location. No way to detect water before digging.
- **Fix Needed**: bot.dig should check for water blocks before digging adjacent to them. Or, provide a way to check block type before digging.
- **Status**: Reported. Session 65. Death.

---

## [2026-03-25] Bug: pillarUp() always times out underground - Session 65 CRITICAL

- **Cause**: bot.pillarUp(30) called at Y=57-66 underground. Cobblestone available (135 blocks). Method either times out (120s) or completes but bot Y doesn't change. Even after placing cobblestone at feet first, pillarUp still times out.
- **Coordinates**: (7.5, 57, 4.5)
- **Last Actions**: pillarUp(30) → 50s timeout → Y=57 unchanged. pillarUp(20) → timeout → Y unchanged. pillarUp(5) → timeout.
- **Error**: "Execution timed out after Xs" OR completes but Y stays same
- **Root Cause**: pillarUp appears to place block at Y-1 (feet) but bot doesn't actually move upward. Scaffold placement loop may be checking wrong conditions or bot is unable to jump underground (ceiling too low? invalid terrain?).
- **Impact**: Bot stuck underground at Y=57-62 with HP=7.5, food=0, night, creepers x5. Cannot escape.
- **Fix Needed**: pillarUp should: 1) check clearance above, 2) dig ceiling if needed, 3) use reliable jump+place loop
- **Status**: Reported. Session 65. BLOCKING - bot cannot escape underground.

---

## [2026-03-25] Bug: bot.flee() navigated through lava - Session 65

- **Cause**: bot.flee() was called when HP=2.3 at y=37 (underground). Bot tried to swim in lava during escape. Server message: "Claude1 tried to swim in lava". Bot survived (HP went to 20 after escape to y=90), but lava navigation is dangerous.
- **Coordinates**: (-9.7, 37.0, 12.0)
- **Last Actions**: flee(30) → lava contact → escaped to y=90
- **Error**: "[Server] Claude1 tried to swim in lava"
- **Root Cause**: bot.flee() pathfinding does not avoid lava blocks. When underground with hostiles, flee may route through dangerous terrain.
- **Fix Needed**: flee() should treat lava as impassable/high-cost terrain during pathfinding.
- **Status**: Reported. Session 65.

---

## [2026-03-25] Bug: Death by zombie during bot.build("shelter") - Session 64 death #2

- **Cause**: Bot at (1.9, 92, -7.9) HP=15.2 Hunger=20 (admin feed active). bot.build("shelter") call timed out after 60s. During timeout, zombie attacked and killed bot. Bot had no armor equipped.
- **Coordinates**: (1.9, 92, -7.9)
- **Last Actions**: build("shelter") → timeout 60s → slain by zombie
- **Error**: "[Server] Claude1 was slain by Zombie"
- **Root Cause**: build() timed out (60s limit), leaving bot vulnerable in place. No armor = full damage from zombie. This is the back near the spawn cliff area where hostiles are constantly present.
- **Fix Needed**: build() should have shorter timeout, or bot should flee before building if hostiles nearby.
- **Status**: Reported. Session 64 death #2.

---

## [2026-03-25] Bug: Bot trapped at y=36-50 cave - all escape methods fail - Session 64 SEVERE

- **Cause**: Bot fell to y=36 (from y=50 underground). tunnel("up") sent bot DOWN to y=36. tunnel("north/south/east/west") all kept bot at y=36. navigate() to all block types returns y=50 blocks (underground grass/dirt). pillarUp fails "no solid ground". gather(stone) returns 0. All movement stays within y=36-55 zone. HP=2.3 from hostiles/starvation.
- **Coordinates**: (-3.7, 36, 13.1)
- **Last Actions**: tunnel("up") → y=36 (went down!), all directions tunnel → y=36, all gather → y=40 (no change)
- **Root Cause**: Bot is in an enclosed cave at y=36-55 that has no pathfindable exit. The cave has grass_block/dirt blocks at y=50 (cave ceiling/floor). All pathfinding leads to these underground blocks. pillarUp fails because either cave ceiling blocks movement, or no "solid ground" detected correctly underground.
- **Fix Required**:
  1. tunnel("up") should actually dig UPWARD (positive Y) not move bot down
  2. pillarUp() needs to detect cave ceiling and dig through it
  3. Alternatively: admin /tp is truly the only solution
- **Status**: SEVERE. Session 64. Bot trapped underground for >30 minutes.

---

## [2026-03-25] Bug: Drowned during wait() loop - Session 64 death #6

- **Cause**: Bot at (-2,90,5) HP=20 waiting for dawn. Drowned during wait interval. The wait() auto-flee moved bot into water nearby. This is the 3rd drowning in this session.
- **Error**: "[Server] Claude1 drowned"
- **Status**: Reported.

---

## [2026-03-25] Bug: Death by zombie - Session 64 death #5

- **Cause**: Bot HP=20 during midnight wait at (4.5,94,8.5). Slain by zombie during wait interval.
- **Error**: "[Server] Claude1 was slain by Zombie"
- **Status**: Reported.

---

## [2026-03-25] Bug: Death by zombie - Session 64 death #4

- **Cause**: Bot HP=20 during midnight wait, zombie killed during server-side movement. Position changed from (4.5,94,8.5) to somewhere else between wait iterations.
- **Error**: "[Server] Claude1 was slain by Zombie"
- **Status**: Reported. Session 64 death #4.

---

## [2026-03-25] Bug: Spawn area terrain prison - all paths return to x=0-10,z=-10-5 - Session 64 ROOT CAUSE

- **Cause**: pathfinder cannot find any path AWAY from spawn area (x=0-30,z=-25 to 10). ALL movement functions (moveTo, navigate, flee, gather) return the bot to the same spawn center within 100 blocks. moveTo(200,70,200) → arrived at (4,65,-3). flee(200) → moved 0.1 blocks. This is the ROOT CAUSE of all prior stuck-at-cliff bugs.
- **Evidence**: Tested moveTo to (50,70,50), (100,70,100), (150,70,150), (200,70,200) - all arrived within (0-5, 64-70, -8 to 5).
- **Fix Required**: Admin /tp to plains biome (x=300,y=70,z=300) AND change spawn point. OR pathfinder larger search radius.
- **Status**: CRITICAL ROOT BUG. Session 64.

---

## [2026-03-25] Bug: bot.navigate() ALWAYS returns 0.0 distance - Session 64 CRITICAL

- **Cause**: bot.navigate({type:'entity',name:'cow'}) and bot.navigate({type:'block',name:'iron_ore'}) both return immediately without moving the bot. Distance moved = 0.0 in ALL cases. navigate("furnace") worked once (moved 3 blocks) but navigate with object type never moves bot.
- **Coordinates**: Tested at multiple positions: (10.3,100,-0.5), (39.7,76,-2.5), (8.7,92,9.8)
- **Evidence**: "Navigate cow: moved 0.0 blocks", "Navigate iron: moved 0.0 to same pos"
- **Root Cause Theory**: navigate() with {type:'entity/block', name:...} format may not be the correct API call format, OR pathfinder fails to find entities/blocks, OR navigate() crashes silently.
- **Impact**: Cannot reach animals for food. Cannot reach iron ore. Cannot make any gameplay progress.
- **Status**: CRITICAL. Session 64.

---

## [2026-03-25] Bug: bot.flee() moves toward more hostile mobs - Session 64

- **Cause**: flee(250) from position (-15,72,-4) with 3 threats → moved to (2,72,-4) with 6 threats. flee() is running TOWARD more mobs instead of away. This is extremely dangerous (HP dropped from 7 to near-death).
- **Expected**: flee() should find direction away from all mobs and move there
- **Actual**: flee() navigated toward spawn area (x=0,z=0) which has highest mob density
- **Status**: CRITICAL BUG. Session 64.

---

## [2026-03-25] Bug: Bot drowned - moveTo navigated into water - Session 64 death #3

- **Cause**: moveTo(4,82,14) sent bot to (1,95,18) instead. Bot drowned. The pathfinder navigated through/into water while trying to reach chest.
- **Coordinates**: (1, 95, 18) — water location near spawn
- **Last Actions**: moveTo(4,82,14) → arrived (1,95,18) → drowned
- **Error**: "[Server] Claude1 drowned"
- **Root Cause**: moveTo() is pathfinding through water. Bot cannot swim. Pathfinder should avoid water blocks when bot has no water breathing potion.
- **Status**: Reported. Session 64 death #3.

---

## [2026-03-25] Bug: bot.combat() NEVER drops food - All sessions - CRITICAL

- **Cause**: bot.combat() against cow/pig/chicken/sheep/zombie returns 0 food drops in ALL sessions. bot.navigate({type:'entity',name:'cow'}) confirms it finds and reaches the animal (position changes), but after combat(), inventory has no new food items. This is not related to gamerule (doMobLoot is TRUE per earlier confirmation). The combat() API kills mobs but doesn't collect drops.
- **Evidence**: Session 64 - tested cow/pig/sheep/chicken/zombie at multiple locations, all 0 drops after combat().
- **Expected**: raw_beef, raw_porkchop, raw_chicken etc. should appear in inventory after combat.
- **Actual**: Zero food items added to inventory after any animal combat.
- **Impact**: Bot CANNOT get food naturally. Relies entirely on admin /feed.
- **Status**: CRITICAL ONGOING. All sessions. Needs urgent fix to item pickup in combat API.

---

## [2026-03-25] Bug: moveTo/navigate silently fails for long distances - Session 64

- **Cause**: bot.moveTo(x+200, y, z+200) only moves 1-3 blocks instead of 200. No error thrown. bot.navigate({type:'entity',name:'cow'}) "finds" target but doesn't move bot far (position changes by <10 blocks then returns success). bot.navigate({type:'block',name:'iron_ore'}) navigates bot to same position and gather() returns 0 items. Pathfinder silently fails for anything beyond ~10 blocks.
- **Coordinates**: Multiple locations: (26,77,-6), (51,95,3), (88,70,90), (78,71,79)
- **Evidence**: moveTo(278,70,277) from (78,71,77) → arrived at (78,71,79). moveTo(126,77,-6) from (26,77,-6) → arrived at (29,77,-7).
- **Impact**: Bot cannot explore, cannot find food/resources, cannot make progress on any phase.
- **Root Cause Theory**: Pathfinder path limit too short, or terrain blocks all paths, or there is a max-distance cap on pathfinding that is too small (~10 blocks?).
- **Status**: CRITICAL. Pathfinder distance bug. Session 64.

---

## [2026-03-25] Bug: Death by zombie - HP=1.5 no food recovery - Session 64

- **Cause**: Bot at (-14.7, 72.6, -2.4), HP=1.5 (zombie attack). No food items in inventory. bot.combat() does not drop food from any animal (cow/chicken/pig/zombie - all 0 drops). bot.eat() cannot eat because no food. bot.flee() moved bot to y=101 with HP=20 (admin refill again). Then slain by zombie.
- **Coordinates**: (-14.7, 72.6, -2.4) at time of critical HP
- **Last Actions**: flee(50) → HP became 20 briefly → "Claude1 was slain by Zombie"
- **Error Message**: "[Server] Claude1 was slain by Zombie"
- **Root Bug**: bot.combat() NEVER drops food items from any animal type. This has persisted across all sessions. Without food drops, hunger cannot be managed naturally.
- **Status**: Reported. Session 64 death #1.

---

## [2026-03-25] Bug: Bot STILL stuck at cliff (26,83,-3) after wait() fix - Session 64 ONGOING

- **Cause**: After wait() fix (67e5137), bot reconnected at HP=1, Hunger=0, same cliff location (26.7,83,-2.3) as Sessions 58-63. wait() no longer aborts BUT movement still completely fails: moveTo/flee/navigate/pillarUp ALL return bot to same position. bot.gather() works (slight position shifts 0.5-1 block) but bot cannot leave the cliff zone. 17 hostiles nearby (skeleton x4, creeper x9-10, zombie x1, drowned x1, spider x1). Survived night at HP=1 (hostiles not killing = confirmation of terrain trap).
- **Coordinates**: (26.7, 83, -2.3) — SAME cliff zone as Sessions 58-63
- **Last Actions**:
  1. mc_reload after connection
  2. flee(50) → no movement
  3. pillarUp(8) → Y unchanged (44s spent)
  4. navigate('cow') → combat('cow') → 0 food drops
  5. moveTo(100,83,100) → no movement
  6. step-by-step moveTo → all fail, return to (26,83,-3)
  7. Waited full night (ticks 13813→23933 = ~2.5 hours game time)
  8. navigate('furnace') → no movement
  9. navigate('coal_ore') → position shifted 0.2 blocks only
  10. gather('coal_ore') → slight position shift only
  11. farm() → no wheat, no food
- **Root Cause**: Pathfinder CANNOT navigate from this terrain. Bot stands on/near cliff edge. pathfinder finds no valid path away. moveTo silently "succeeds" without moving. wait() fix did NOT fix movement — the problem is deeper in pathfinder terrain handling.
- **Critical**: 7+ consecutive sessions (58-64) stuck at same cliff. Admin /tp + /feed REQUIRED to escape this terrain trap. Code fix needed: pathfinder must handle no_path gracefully with jump/place-block fallback, OR spawn point must be changed.
- **Status**: CRITICAL ONGOING. Session 64.

---

## [2026-03-25] Bug: wait() HP=1 abort makes ALL movement impossible - Sessions 58-63 CRITICAL ROOT CAUSE

- **Cause**: bot.wait() aborts at HP<3 even when HP is STABLE at 1.0. This creates an infinite loop: HP=1 → wait() aborts → no movement possible → no food → no HP recovery → HP stays at 1. ALL movement APIs (flee, moveTo, pillarUp, setControlState) use wait() internally and fail. The only way to move is without wait(), but the sandbox has no setTimeout/setInterval.
- **Coordinates**: (26.3, 83, -2.5) — same cliff zone Sessions 58-63
- **Root Cause**: wait() function has `if (hp < 3) abort` check. At HP=1 (stable, not dropping), this fires every single time regardless of actual danger. Bot cannot move AT ALL when HP=1.
- **Fix Required**: In bot.wait(): if HP is stable at 1 (same as previous check), do NOT abort. Only abort if HP is actively dropping (hpDroppedSinceStart > 0). The stable HP=1 case means minecraft's natural half-heart protection — bot is not in active danger.
- **Evidence**: 7 sessions (58-63) all stuck at same location. wait() shows "ABORTED: HP dropped to 1.0" even though HP is STABLE at 1.0 (not dropping).
- **Status**: CRITICAL ROOT BUG. Needs code fix to wait() in mc-execute.ts/core-tools.ts

---

## [2026-03-25] Bug: Bot stuck at cliff (26.5,83,-2.3) - HP=1, no food, all movement fails - Session 63

- **Cause**: Bot at (26.5, 83, -2.3), HP=1, Hunger=0, no food in inventory. SAME cliff area as Sessions 58-62. All movement APIs fail: moveTo, flee, navigate, pillarUp, setControlState all leave bot at same position. 7+ hostiles nearby (pillager x1, bat x11, skeleton x3, creeper x7, zombie x1, drowned x1, spider x1). combat('zombie') does not produce rotten flesh. ender_pearl in inventory but no API to throw it. wait() ABORTS immediately due to HP=1.
- **Coordinates**: (26.5, 83, -2.3) — same cliff zone as Sessions 58-62
- **Last Actions**:
  1. Connected with Claude1 — bot already at HP=1, Hunger=0 with no food
  2. flee(30) → no movement
  3. setControlState all directions + jump → no horizontal movement
  4. pillarUp(5) → Y unchanged
  5. moveTo(50,84,50) → returns to (26.5,83,-2.3)
  6. combat('zombie') → no rotten flesh dropped
  7. navigate('cow') → no movement
  8. placed cobblestone N/S/E/W → still can't move
- **Error Message**: "[wait] ABORTED: HP dropped to 1.0 during wait" — all wait() calls abort
- **Critical Issues**:
  1. Bot has been stuck at this specific cliff (26,83~86,-3) for Sessions 58-63 (6 sessions!)
  2. No food obtainable — combat drops nothing, no animals reachable
  3. moveTo pathfinder completely broken at this terrain — always returns to same spot
  4. HP=1 prevents any wait() calls from completing
  5. ender_pearl in inventory but no API to throw/use items directly
- **Status**: CRITICAL RECURRING. Session 63. Admin /tp + /feed required to escape. Root terrain bug at (26,83,-3) persists across all code fixes.
- **Suggested Fix**: Admin needs to /tp bot away from (26,83,-3) spawn point and /feed. Also: bot.use(item) or ender pearl throw API needed. Also: pathfinder must be fixed to not return to same stuck point.

---

## [2026-03-25] Bug: Bot STILL stuck at (26,84,-4) - moveTo always returns to same location - Session 62

- **Cause**: Bot at (26.5, 84, -3.7), HP=1, Hunger=0. mc_reload + reconnect performed (commit 5d42734 fix). moveTo(35,85,5), moveTo(26,84,0), moveTo(26,84,10) ALL return bot to (26,84,-4). Bot is stuck in pathfinder loop despite cobblestone placed at (25-29,84,-3), (26,84,-2 to 0). flee(20) also returns to same location.
- **Coordinates**: (26.5, 84.0, -3.7)
- **Last Actions**:
  1. mc_reload (build + hot-reload after 5d42734 fix)
  2. moveTo(35,85,5) → returns to (26,85,-4)
  3. Placed cobblestone at multiple locations around bot
  4. moveTo(26,84,0) → returns to (26,84,-4)
  5. moveTo(26,84,10) → returns to (26,84,-4)
  6. flee(20) → no movement
- **Error Message**: No error thrown but position never changes from (26,84,-4) regardless of target
- **Critical Issues**:
  1. moveTo always returns bot to same location (26,84,-4) — pathfinder may be using this as a "safe" spot
  2. HP=1 with no food, cannot recover
  3. Bot has been stuck at this cliff area for Sessions 58-62
- **Status**: CRITICAL - ONGOING. Additional findings from Session 62 continued:
  - pillarUp(3/6) → always times out (30s)
  - flee(30) → returns to same position (26,84,-3)
  - navigate({type:'entity',name:'cow',max_distance:200}) → no movement
  - navigate('cow'/'pig'/'sheep'/'chicken') → no movement
  - Morning phase (ticks=973) still has skeleton x3, creeper x7 nearby
  - combat('cow') → returns immediately, no food dropped (food drop bug confirmed again)
  - ALL movement APIs fail: moveTo, flee, navigate, pillarUp all return bot to (26,84,-3)
  - Root cause: pathfinder is completely broken at this specific terrain location
  - Admin /tp is REQUIRED to escape. Bot cannot self-rescue.

---

## [2026-03-25] Bug: Bot STILL stuck at cliff edge Y=86 - HP1 Hunger0 - pillarUp not working - Session 61

- **Cause**: Bot starts at (26.5, 86, -3.5) same birch_forest cliff area. HP=1, Hunger=0, no food in inventory. pillarUp(8) logs "executed" but Y stays at 86.0. bot.eat() returns but hunger stays 0 (no food items). bot.combat("cow") returns immediately with no food. wait() ABORTS immediately due to "HP dropped to 1.0". Night phase "midnight" persists for 1300+ ticks. Creeper x6-7, skeleton x3, zombie x2, drowned x1, spider x1 nearby.
- **Coordinates**: (26.5, 86, -3.5) - same cliff area as previous sessions
- **Last Actions**:
  1. bot.flee(30) → HP still 1, position unchanged
  2. bot.pillarUp(5) then pillarUp(8) → Y stays at 86.0 (not working)
  3. bot.eat() → hunger stays 0 (no food)
  4. bot.combat("cow") → returns immediately, no food
  5. bot.build("shelter") → success but HP still 1
  6. bot.wait(5000) → ABORTS "HP dropped to 1.0 during wait"
- **Error Message**: "[wait] ABORTED: HP dropped to 1.0 during wait — auto-fleeing from danger" x14 times
- **Critical Issues**:
  1. pillarUp does not change Y position (claimed "success" but Y unchanged)
  2. Night phase "midnight" persists abnormally long (1300+ ticks in this session alone)
  3. No food in inventory after multiple sessions - combat food drop bug persists
  4. HP cannot go below 1 but also cannot recover without food
  5. Bot is completely stuck with no way to get food or escape
- **Status**: CRITICAL. Bot survival is impossible without admin intervention. Need: /feed + /tp away from cliff + food items. Same location as Sessions 58-60.
- **Additional Findings (Session 61 continued)**:
  - bot.wait() ABORTS every time due to "HP dropped to 1.0" even during daytime (ticks 6093-6393)
  - Daytime (phase:day) started but mobs still attacking (creeper, skeleton in daytime = bug or mob behavior)
  - moveTo(27, 86, -4) always returns to (26.7, 86.0, -3.5) — pathfinder is completely unable to path from this exact location
  - cobblestone place() succeeds at nearby coords but moveTo after place() still fails
  - This is the SAME location (26.5-26.7, 86.0, -3.5 to -4.0) as Sessions 58-60 — the bot always spawns/ends up here
  - Root cause theory: The spawn/respawn point is set to this exact cliff edge location, and the pathfinder cannot navigate FROM this specific location (possibly the block structure prevents it)

---

## [2026-03-25] Bug: Bot still stuck at cliff edge Y=89 - moveTo/navigate/flee all fail - Session 60

- **Cause**: Bot is still stuck at same cliff edge (27, 89, -14) as Session 59. moveTo to 6 different far coordinates all return immediately without moving. navigate("cow"), navigate("chicken") return immediately. flee(50) returns without moving. Position stays at (27, 89, -14) regardless of command.
- **Coordinates**: (27, 89, -14) - same cliff edge in birch_forest biome as previous sessions
- **Last Actions**:
  1. moveTo(80, 89, -12) → position unchanged (27, 89, -14)
  2. moveTo(-30, 89, -12) → position unchanged
  3. navigate("cow") → returns in 447ms, position unchanged
  4. flee(50) → returns but position unchanged
  5. pillarUp(10) → "Failed to pillar up. No blocks placed" after 59s timeout
- **Error Message**: moveTo returns silently with no movement, pillarUp times out after 59s
- **Status**: CRITICAL - Bot survived at HP=1 for extended period but cannot escape. flee() always returns to (26.5,86,-3.5). Night has been ongoing for 3000+ ticks without ending (possible time bug or gamerule issue). Mob count constantly 14+ entities including creeper x5, skeleton x3-4, zombie, drowned, spider, pillager. Hunger=0 entire session, combat food drops still not working. Needs admin /tp + /heal + /feed OR code fix for: 1) pathfinder escape from cliff 2) food drops from combat 3) night ending normally.

---

## [2026-03-25] Bug: Bot completely stuck at cliff edge Y=90 - all actions timeout - Session 59

- **Cause**: Bot is stuck at cliff edge at Y=90-91. ALL navigation actions (moveTo, navigate, flee, gather, combat) timeout after 60-120 seconds without moving more than 1-2 blocks. cobblestone place() succeeded but subsequent moveTo fails.
- **Coordinates**: (27.5, 91.0, -10.1) - cliff edge in birch forest biome
- **Last Actions**:
  1. All moveTo attempts in 6 directions → position unchanged
  2. bot.pillarUp(4) → "success" but Y unchanged
  3. bot.navigate("chest") → position unchanged
  4. bot.flee(30) → timeout
  5. bot.gather("stone", 3) → timeout
  6. bot.gather("iron_ore", 8) → timeout
- **Error Message**: Execution timed out after 60000ms / 120000ms
- **Status**: Reported. Bot is completely unable to navigate from cliff edge. Likely pathfinder cannot find valid path. Need admin /tp or code fix to handle cliff-edge stuck state.

---

## [2026-03-25] Bug: bot.setControlState is not a function - Session 59

- **Cause**: `bot.setControlState('forward', true)` throws `TypeError: bot.setControlState is not a function` inside mc_execute sandbox. Admin instructed using setControlState to escape cliff, but the method is not exposed in the bot API object.
- **Coordinates**: (27.6, 90.0, -12.2) stuck on cliff at Y=90
- **Last Actions**: Tried all moveTo directions (6 directions) but position unchanged. Admin suggested setControlState as workaround.
- **Error Message**: `TypeError: bot.setControlState is not a function`
- **Status**: Reported. Need to expose bot.setControlState in mc_execute sandbox, or add bot.moveForward()/bot.jump() helpers.

---

## [2026-03-25] Bug: bot.combat() kills animals but NO food drops collected - Session 58

- **Cause**: bot.combat("cow"), bot.combat("chicken"), bot.combat("pig") all return success, but no food items (raw_beef, raw_chicken, raw_porkchop, etc.) appear in inventory after repeated kills.
- **Coordinates**: (28, 92, -10) in birch_forest biome
- **Last Actions**: Session 58. /tp脱出後にbot.combat("cow"), combat("chicken"), combat("pig")を各1回実行。全て即座にリターンするが食料ドロップなし。インベントリ変化なし。
- **Error Message**: No error thrown, just no items dropped/collected
- **Evidence**: Inventory before/after combat identical (21 item types, 0 food). wheat_seeds:54, cobblestone:114 unchanged.
- **Previous Session Note**: Session56バグ報告にも "bot.combat returns immediately without finding/killing animals" との記述あり。動物を本当に殺せているかも疑わしい。
- **Status**: Reported. Workaround: use bot.farm() with wheat_seeds instead.

---

## [2026-03-25] Bug: ALL movement/action tools non-functional - Session 57 (CRITICAL継続)

- **Cause**: Session56のバグが継続。Bot完全スタック at (29.7, 91, -6.5). pillarUp/gather("stone")/flee全てタイムアウト/失敗。
  - bot.moveTo(50, 92, -7): x方向移動0（29のまま）
  - bot.navigate({target_block:"iron_ore", max_distance:128}): "Path blocked" 到達不能
  - bot.gather("iron_ore", 16): 120sタイムアウト
  - bot.gather("stone", 10): 120sタイムアウト
  - bot.pillarUp(4): 60sタイムアウト
  - bot.flee(30): 位置変化なし
  - bot.build("shelter"): 120sタイムアウト
- **Coordinates**: Bot stuck at (29.7, 91, -6.5) in birch_forest biome. iron_ore最近距離: (68, 54, -14) at 54 blocks
- **Last Actions**: 夜間待機→朝に鉄採掘試みるも全失敗。前回置いたcobblestone壁が閉じ込めを悪化させた可能性あり。
- **Navigation Error**: "Navigation stopped after 2/2 segments: Cannot reach (18.15, 92, -52.87). Path blocked."
- **周囲の状況**: grass_blockがY=93-98に分布（丘の上）。石と土に完全に囲まれた地形。
- **Status**: Critical. Phase4鉄採掘完全停止。code-reviewerによる pathfinder根本修正が必要。
- **追加調査 (Session57)**:
  - 周囲地形: 東西南北のY=91は石(stone)。南(z=-4〜-6)は空気→dirtを設置可能。
  - 足元の南側(z=-6, y=90)は空洞(崖になっている)。
  - bot.craft()もタイムアウト(crafting_tableが近くにない)。
  - 再接続しても状況変わらず。
  - place()は南方向のみ機能。他は全てタイムアウトか即リターン。
  - bot.moveTo()は即座にリターン(965ms)、位置変化なし = pathfinder がパスなしと即判定。
  - **根本原因仮説**: ボットが石の塊(Y=90足元が石、東西北が石)に囲まれており、南方向には崖(y=90が空洞)があるため、pathfinderが有効な経路を見つけられない。落下を避けるためにどの方向にも動けないと判定している可能性。
  - **解決策候補**: pathfinderに落下許可オプションを渡す、またはforce-teleportでスタック位置から脱出させるリセット機能の追加。

---

## [2026-03-25] Bug: ALL movement/action tools non-functional - Session 56 (CRITICAL)

- **Cause**: Bot is completely stuck at position (29-30, 92-95, -4 to -7). ALL action tools fail:
  - bot.moveTo(): Returns without moving (5-38s, no error). Tried 5+ different coordinates with 40-100 block offsets.
  - bot.navigate(): Returns immediately without moving (pos unchanged).
  - bot.gather(): Timeouts after 30-120s even for count=1.
  - bot.farm(): Timeouts after 60-120s.
  - bot.build("shelter"): Timeouts after 60s.
  - bot.pillarUp(): Timeouts after 60s.
  - bot.combat("cow"/"pig"/"chicken"/"sheep"): Returns immediately without finding/killing animals (no animals exist nearby).
- **Coordinates**: Bot stuck at (29-30, 92-95, -5) in birch_forest biome.
- **Last Actions**: All the above tools attempted multiple times, all fail silently or timeout.
- **Working Tools**: bot.status(), bot.inventory(), bot.craft(), bot.place(), bot.wait(), bot.eat() — stationary/inventory operations work fine.
- **Root Cause Hypothesis**: Pathfinder may be completely broken at current position. Possible terrain issue, stuck in/near a structure, or pathfinder state corruption.
- **Impact**: Cannot progress at all. Food=1 bread. Phase 4 iron mining blocked. Bot cannot move.
- **Status**: Reported. Critical bug — code reviewer must investigate pathfinder state at (29, 92, -5) in birch_forest.

---

## [2026-03-24] Bug: Death by zombie - pillarUp placement failure during night - Session 55

- **Cause**: bot.pillarUp(6) returned "Pillared up 17.0 blocks (Y:97→114, placed 0/6). PARTIAL: Stopped early (6 blocks short). Reason: Placement failed" — zombie at 14.9 blocks south killed bot during the 19s pillarUp execution. pillarUp already elevated Y:97→114 (17 blocks) but then failed to place the final 6. Bot was exposed to zombie during the process.
- **Location**: `src/tools/core-tools.ts` pillarUp() — placement failure at elevated position
- **Coordinates**: (38.3, 97, -52.7) start, zombie at south 14.9 blocks
- **Last Actions**: status() showed zombie nearby → pillarUp(6) called → zombie killed bot during execution
- **Root Cause**: pillarUp reported "placed 0/6" meaning it was already at Y=114 before trying to place blocks, but placement still failed. Bot was vulnerable during the 19s execution window. Zombie walked to bot and attacked while pillarUp was failing.
- **Fix Needed**: pillarUp() should detect nearby threats and immediately place 1 block under feet as emergency shelter, then attempt higher pillar. Or should flee first before pillaring.
- **Status**: Recorded. Bot died at Y:97, z:-52.7. Respawned at (-9.5, 114, -7.5).

---

## [2026-03-24] Bug: Death by zombie - pillarUp failed during night - Session 54

- **Cause**: bot.pillarUp(6) failed with "No blocks placed" despite having 106 cobblestone in inventory. Bot had already fled from zombie but pillarUp failed twice. Zombie caught and killed bot.
- **Location**: `src/tools/core-tools.ts` pillarUp() — fails to place blocks even when scaffold blocks (cobblestone x106, dirt x71) are available
- **Coordinates**: ~(-3, 114, -12) at midnight in birch_forest biome
- **Last Actions**: flee(20) succeeded → pillarUp(6) failed (attempt 1, 34s) → pillarUp(6) failed (attempt 2, 17s) → zombie slain bot
- **Root Cause**: pillarUp() may be failing because the bot is on terrain that's not flat/solid, or the bot can't equip cobblestone to hand properly at Y=114 elevation
- **Fix Needed**: pillarUp() should fall back to dirt if cobblestone fails, and should explicitly select scaffold blocks before attempting to place
- **Status**: Recorded. Bot died. Reconnecting.

---

## [2026-03-24] Bug: Death by drowned during bot.farm() - Session 53

- **Cause**: bot.farm() navigated bot close to water at (2, 72, 5) to use it for irrigation. Drowned mob in water killed bot. flee() reported success (hp=20, threats=0) but death had already occurred.
- **Location**: `src/tools/high-level-actions.ts` farm() — moves bot to water source for irrigation, drowned spawns from water and kills bot
- **Coordinates**: (1.4, 50, 4.4) at death (fell to y=50 underground near water)
- **Last Actions**: bot.farm() timed out after 120s during dirt placement, then attempted to harvest nearby wheat near water → drowned attack
- **Root Cause**: farm() finds water at (2,72,5) for irrigation, moves bot near water, drowned at 14.9 blocks attacks. Filter "within 4 blocks of water" filtered farmCoords but still moved bot to water area.
- **Fix Needed**: farm() should not navigate bot within 20 blocks of any drowned mob. Check threats before/during navigation to water.
- **Status**: Recorded. Bot respawned at (−5.5, 118, 2.1) with keepInventory. HP=20.

---

## [2026-03-24] Bug: Death by drowned - HP=0.5 unable to recover - Session 52

- **Cause**: Bot started with HP=0.5 from previous session. Drowned spawned from water at coordinates near base. flee() repeatedly returned to same location (x=2,y=70,z=5). Could not pillarUp (failed), could not escape. Drowned killed bot at dawn.
- **Location**: `src/tools/core-tools.ts` flee() — fails to navigate away from water mob (drowned), returns to same coordinates
- **Coordinates**: (2, 70, 5) — death confirmed by "[Server] Claude1 drowned"
- **Last Actions**: flee(40) x3 (all returned to same pos), wall building (cobblestone 4 sides), then waited 5s → death
- **Root Cause 1**: flee() does not avoid water sources, drowned can chase bot in/around water indefinitely
- **Root Cause 2**: At HP=0.5, hunger=11 — natural regen requires hunger>=18, so HP could not recover
- **Root Cause 3**: pillarUp() failed with "No blocks placed" despite having 81 dirt in inventory — no solid ground detection issue
- **Fix Needed**: (1) flee() should move bot away from water/drowned direction, (2) pillarUp() should work reliably when inventory has scaffold blocks
- **Status**: Recorded. Bot respawned with keepInventory, HP=20.

---

## [2026-03-24] Bug: Double death - zombie kill + fall damage - Session 50

- **Cause**: bot.farm() hung 180s letting mobs damage bot (HP 9→4). bot.flee(40) ran bot into zombie → death. Then "Claude1 fell from a high place" death also occurred (likely flee sent bot to Y=110 and fell).
- **Location**: flee() in `src/tools/core-tools.ts` — flees to dangerously high elevation (Y=110)
- **Coordinates**: (-3, 69, -8) → zombie death → (9, 110, -7) → fall death
- **Last Actions**: farm() 180s timeout → flee(40) → "slain by Zombie" → "fell from a high place"
- **Root Cause 1**: bot.farm() no timeout, allows prolonged mob exposure
- **Root Cause 2**: bot.flee() pathfinds to Y=110+ causing fall death after zombie death
- **Fix Applied**: Recording only. Fixes: (1) farm() 60-90s global timeout, (2) flee() should cap Y movement
- **Status**: Recorded. Two deaths in sequence.

---

## [2026-03-24] Bug: Death during flee - zombie killed at HP=4 - Session 50

- **Cause**: bot.farm() hung for 180s during which mobs damaged bot from HP=9 to HP=4. After farm timeout, flee() was called but zombie killed bot during flee movement.
- **Location**: `src/tools/high-level-actions.ts` farm() — no timeout guard allowing mob damage during hang
- **Coordinates**: (-3, 69, -8) → death at (9, 110, -7)
- **Last Actions**: bot.farm() 180s timeout (HP went from 9→4 during hang) → bot.flee(40) → "Claude1 was slain by Zombie"
- **Root Cause 1**: bot.farm() has no timeout, allows prolonged exposure to mobs during daytime farming
- **Root Cause 2**: bot.flee() runs into zombie while fleeing (no path safety check)
- **Fix Applied**: Recording only. Fixes needed: (1) bot.farm() global timeout 60-90s, (2) flee should check threats along path
- **Status**: Recorded. DEATH. Respawn needed.

---

## [2026-03-24] Bug: bot.farm() timeout after 180s - never returns - Session 50

- **Cause**: bot.farm() hangs indefinitely, exceeding 180s timeout. No logs output even after start. Likely stuck in farmland preparation loop or waiting for water source placement when pathfinder is obstructed.
- **Location**: `src/tools/high-level-actions.ts` or `src/tools/core-tools.ts` farm implementation
- **Coordinates**: (-6, 73, -3) birch_forest
- **Last Actions**: Dawn just started. 10 threats >10 blocks away. Called bot.farm() with 43 wheat_seeds in inventory. No output after 180s.
- **Root Cause**: farm() likely tries to till/navigate terrain and hits pathfinder deadlock or infinite loop without timeout guard.
- **Fix Applied**: Recording only. Fix: Add global 120s timeout to bot.farm() similar to bot.gather(). Add progress logging inside farm loop.
- **Status**: Recorded.

---

## [2026-03-24] Bug: moveTo() タイムアウト - pathfinder詰まり - Session 49

- **Cause**: bot.moveTo() が全方向でタイムアウト。bot.flee()も移動できず同じ場所に留まり続ける。farm()が穴掘り作業中に地形を変えてpathfinderが通れなくなった可能性。
- **Location**: `src/bot-manager/pathfinder.ts` または `src/tools/core-tools.ts` moveTo実装
- **Coordinates**: (2, 71, 6) — y=71、birch_forest
- **Last Actions**: bot.farm()実行中に地形変化（dirt配置・穴掘り）。その後flee()・moveTo(-50,70,0)・moveTo(2,71,-10)が全てタイムアウト
- **Root Cause**: farm()が地形変更（空中にdirt設置、穴掘り）を行いpathfinderが迷路化。CLAUDE.mdの「掘った穴は埋め戻せ」ルール違反。
- **Fix Applied**: 記録のみ。Fix: farm()が地形変更した箇所を完了時に元に戻す、またはpathfinder timeout後に代替経路計算を試みる。
- **Status**: 記録済。HP9 Hunger7で敵12m圏内。深刻な状況。

---

## [2026-03-23] Bug: mc_farm continues stationary operation when HP=2.5 + zombie 0.7 blocks away → death - Session 48

- **Cause**: mc_farm issues WARNING but continues when HP < 8 or hostiles nearby. At HP=2.5 with zombie 0.7 blocks away, continuing farm operation is fatal. Should abort and flee, not just warn.
- **Location**: `src/tools/core-tools.ts` mc_farm function (~line 716-784)
- **Coordinates**: (14, 70, 3) — near water source at (13, 72, -1)
- **Last Actions**: bot.farm() was running. Tilling failed 4 times. HP dropped to 2.5. Zombie at 0.7 blocks. Farm WARNING logged but continued. Result: "Claude1 was slain by Zombie", then "Claude1 fell from a high place" x2
- **Root Cause**: mc_farm converted ABORT → WARNING for HP < 8 and hostiles nearby (to prevent "deadlock"). But WARNING-only mode allows lethal continuation. Need: flee immediately when HP < 5 OR hostile within 2 blocks, regardless of deadlock concerns.
- **Fix Applied**: 記録のみ。Fix: add ABORT condition inside farm loop: if (hp < 5 || hostile_within_2_blocks) { flee(); return error_message; }
- **Status**: 記録済。

---

## [2026-03-23] Bug: bot.wait() aborts when HP=5.0 even though HP is stable (not dropping) - Session 47

- **Cause**: `bot.wait()` has HP threshold check that triggers "auto-flee" when HP <= 5.0, even when HP is not actually dropping. This creates an infinite abort loop when bot is at exactly 5.0 HP.
- **Location**: `src/tools/core-tools.ts` or `src/tools/mc-execute.ts` (wait implementation)
- **Coordinates**: (12, 90, 5)
- **Last Actions**: Bot pillarUp'd for night safety at HP=5. Called bot.wait(5000) to wait for morning. Wait immediately aborted with "ABORTED: HP dropped to 5.0 during wait — auto-fleeing from danger" even though HP was not dropping.
- **Root Cause**: wait() checks if `currentHP <= threshold` but should check if `currentHP < previousHP` (actual drop). HP=5.0 stable is NOT dangerous — HP=5.0 and dropping is dangerous.
- **Fix Applied**: 記録のみ。Fix: change wait() HP check from `hp <= 5` to `hp < startingHp` (actual decrease detection).
- **Status**: 記録済。

---

## [2026-03-23] Bug: No mob food drops - cow/pig/chicken combat yields 0 food items - Session 47

- **Cause**: `bot.combat("cow")`, `bot.combat("pig")`, `bot.combat("chicken")` all complete successfully but no food items (raw_beef, raw_porkchop, raw_chicken) appear in inventory.
- **Location**: birch_forest around (-18, 94, -16) to (25, 79, -6)
- **Last Actions**: Called bot.combat("cow"), bot.combat("pig"), bot.combat("chicken") in sequence. All returned success. No food drops.
- **Root Cause**: Either (1) entity drops are not working despite doMobLoot=true gamerule, or (2) combat() kills mob but bot doesn't collect the drops (moves away before items land), or (3) combat() bug in item collection.
- **Fix Applied**: 記録のみ。Previous session noted doMobLoot=true but drops still failing.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 fell from high place - moveTo Y=64 on mountain - Session 46b

- **Cause**: Called `bot.moveTo(3, 64, 30)` from mountain at Y=117. Pathfinder walked bot off cliff edge to reach Y=64, resulting in fall death.
- **Location**: (~3, 117, 10) mountain top
- **Coordinates**: (3, 117, 10)
- **Last Actions**: Loop trying moveTo with Y=64 in different XZ directions to find lower terrain
- **Root Cause**: `bot.moveTo(x, Y, z)` does not prevent falling off cliffs. Should use pathfinding with fall damage protection or check terrain before moving.
- **Fix Applied**: コード修正禁止のため記録のみ。`bot.moveTo` should have cliff-edge detection.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 drowned underground - bot.place() hang - Session 46

- **Cause**: Bot was at Y=47 underground with HP=4.8, Hunger=0. Called `bot.place("dirt", ...)` in a loop — execution timed out after 30s while still underwater/underground. Bot drowned before getting to surface.
- **Location**: (~2, 47, -2) underground
- **Coordinates**: (2, 47, -2)
- **Last Actions**:
  1. `bot.flee(20)` — only moved slightly, still underground
  2. `bot.navigate("grass_block")` — did not reach surface
  3. `bot.pillarUp(30)` — failed: "No blocks placed"
  4. `bot.moveTo(x, 65, z)` — did not reach Y=65
  5. `bot.place("dirt", ...)` loop — timed out 30s, bot drowned
- **Root Cause**: `bot.pillarUp()` fails when bot is underwater (cannot place blocks underwater). `bot.navigate("grass_block")` does not reliably path to surface. No swim-up mechanism available.
- **Fix Applied**: コード修正禁止のため記録のみ。`bot.pillarUp()` should detect water and use swim-up logic instead.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 drowned at surface - flee() not escaping hostiles - Session 48

- **Cause**: Bot spawned/was at (8, 74, 2) surrounded by 8 creepers, 2 zombies, 2 skeletons at HP=3. Bot had previously drowned (seen in chat "[Server] Claude1 drowned"). flee(), pillarUp(), moveTo() all failed to change position — bot stayed at exactly (8,74,2) throughout.
- **Location**: (8, 74, 2) birch_forest
- **Coordinates**: (8, 74, 2)
- **Last Actions**:
  1. `bot.flee(40)` — position unchanged (8,74,2)
  2. `bot.pillarUp(8)` — position unchanged
  3. `bot.moveTo(58, 74, 52)` — position unchanged
  4. `bot.wait()` — auto-flee triggered 6+ times but position unchanged
- **Root Cause**: flee() and moveTo() appear to not actually move the bot when surrounded by dense mob clusters. Pathfinder may be blocked by mob entities or terrain. The bot was previously drowned - possibly was in water/underground and position reporting was incorrect.
- **Fix Applied**: 記録のみ。flee() should work even when surrounded — may need to jump/break blocks to escape.
- **Status**: 記録済。

---

## [2026-03-23] Bug: Claude1 shot by Skeleton - HP dropped during wait auto-flee cycle - Session 48b

- **Cause**: HP=5.3 surrounded by 6 creepers, 3 zombies, 4 skeletons in morning daylight. Auto-flee from wait() was triggered but flee() did not move bot far enough away. Skeleton shot bot to HP=2.3 then death.
- **Location**: (2, 74, 0) birch_forest
- **Coordinates**: (2, 74, 0)
- **Last Actions**:
  1. `bot.navigate("cow")` — navigated but entities unchanged
  2. `bot.combat("cow")` — triggered
  3. `bot.wait(2000)` — auto-flee triggered (skeleton at 7.7 blocks), flee completed at HP=2.3
  4. Shot by skeleton, died
- **Root Cause**: Mobs in daylight not burning (possibly in shaded area or mob shade behavior). flee() not moving bot far enough from dense mob clusters. wait() auto-flee threshold may be too close (7.7 blocks is within skeleton arrow range).
- **Fix Applied**: 記録のみ。Skeleton arrow range is 15 blocks — flee threshold should trigger at >15 blocks or flee distance should be >20 blocks.
- **Status**: 記録済。

---

## [2026-03-23] Bug: bot.moveTo() と bot.gather() が完全に機能しない - Session 45

- **Cause**: `bot.moveTo(x, 30, z)` を実行しても位置が全く変わらない。`bot.gather("iron_ore")` や `bot.gather("coal_ore")` もタイムアウトまたは即終了してアイテムが取れない。
- **Location**: birch_forest, (5.8, 68.4, 2.3)
- **Coordinates**: (5.8, 68.4, 2.3)
- **Last Actions**:
  1. `bot.moveTo(5, 30, 2)` → 1秒で終了、位置変化なし (y=68.4のまま)
  2. `bot.moveTo(x+100, 64, z)` → 即終了、位置変化なし
  3. `bot.gather("iron_ore", 8)` → 即終了、raw_iron取得ゼロ
  4. `bot.gather("coal_ore", 8)` → 61秒かかって終了、coal取得ゼロ
- **Root Cause**: pathfinderが動作していない可能性。または内部でエラーが起きて移動を諦めている。
- **Fix Applied**: コード修正禁止のため記録のみ。コードレビューアーに調査を依頼。
- **Status**: 記録済。代替手段を模索中。

---

## [2026-03-23] Bug: Claude1 drowned - moveTo through water - Session 44

- **Cause**: Called `bot.moveTo(1, 88, -3)` from position (8, 101, 29). Pathfinder routed bot through water body, causing drowning death.
- **Location**: (~3, 101, 27)
- **Coordinates**: (8, 101, 29) → drowned en route
- **Last Actions**:
  1. Status check: hunger=6, pos=(8,101,29), biome=birch_forest
  2. Called `bot.moveTo(1, 88, -3)` to return to base
  3. Pathfinder routed through water - bot drowned
  4. keepInventory ON so items preserved
- **Root Cause**: moveTo pathfinder does not avoid water bodies. Bot submerged and could not escape in time. Y difference (101 → 88) combined with water crossing = drowning.
- **Fix Applied**: None (game agent, report only). Need pathfinder to avoid water.
- **Status**: Recorded. Reconnecting and using alternate navigation strategy.

---

## [2026-03-23] Bug: Claude1 died - starvation/hostile in cave - Session 43

- **Cause**: Bot was in underground cave at Y=77-82. Hunger dropped to 0. HP=6.8 with multiple hostiles (drowned, skeleton, zombie). Connection dropped (death). keepInventory ON but stone_pickaxe was missing after reconnect.
- **Location**: (~3, 82, 12)
- **Coordinates**: (3.5, 82, 11.7)
- **Last Actions**:
  1. Trying to get to surface from cave at Y=77
  2. navigate("grass_block") triggered hostile warnings
  3. flee() called, moved to Y=78-82
  4. moveTo(3, 88, 13) - connection closed (death)
  5. Reconnected with hunger=0, missing stone_pickaxe
- **Root Cause**: Bot navigated into cave system while looking for coal_ore. Got trapped by hostile mobs. No food to recover HP. pillarUp failed (no solid footing). Path to surface blocked.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded. Need surface escape + food urgent.

---

## [2026-03-23] Bug: Claude1 killed by Zombie at night - Session 42

- **Cause**: Bot had HP=4.2 at midnight surrounded by skeletons/zombies. flee() ran but bot was teleported to Y=112 (respawn location?) and zombie killed it there. No shelter found during night.
- **Location**: (1.5, 112, 6.5)
- **Coordinates**: (1.5, 112, 6.5)
- **Last Actions**:
  1. Sheltering at night near base (7, 100, -6)
  2. Skeletons surrounded, HP dropped from 20 to 4.2 via arrow damage
  3. flee() couldn't escape mobs
  4. wait(5000) completed, HP showed 20 (respawn?) but then "Claude1 was slain by Zombie"
  5. Respawned at (1.5, 112, 6.5) HP=20 (keepInventory)
- **Root Cause**: Night shelter is inadequate - bot is at Y=102-104 which is elevated open terrain. No enclosed room to hide in. `bot.wait()` with auto-flee doesn't prevent arrow damage from skeletons. During midnight with 4.2 HP, need to be inside fully enclosed shelter.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: Claude1 shot by Pillager during day - Session 41

- **Cause**: Bot was near (7, 104, -4) examining chests/building shelter. Pillager patrol found and shot bot. No armor equipped, no flee triggered.
- **Location**: (7, 104, -4)
- **Coordinates**: (7, 104, -4)
- **Last Actions**:
  1. Building shelter and placing chests
  2. Examining chest contents with mc_execute
  3. Pillager shot bot — "Claude1 was shot by Pillager"
  4. Respawned at (7.5, 104, -4.5) HP=20, hunger=20 (keepInventory)
- **Root Cause**: No armor equipped (NO ARMOR warning ignored). Pillager patrol in area. Bot needs to craft and equip armor before doing base-building activities.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: Claude1 killed by Spider while fleeing - Session 41

- **Cause**: Bot had HP=6, hunger=0 with spider at 1.8 blocks distance. Called `bot.flee(20)` but was killed by spider during flee execution before escaping.
- **Location**: (103.9, 73.2, 13.3) old_growth_birch_forest
- **Coordinates**: (103.9, 73.2, 13.3)
- **Last Actions**:
  1. Status showed HP=6, hunger=0, spider at 1.8 blocks
  2. Called `bot.flee(20)`
  3. Spider killed bot during flee — "Claude1 was slain by Spider"
  4. Respawned at (13.6, 102, 6.4) with HP=20, hunger=20 (keepInventory)
- **Root Cause**: `bot.flee()` does not protect against melee damage during execution when mob is already within attack range (1.8 blocks). Bot should attack back or use pillarUp when mob is <3 blocks, not flee.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: Claude1 starved/died underground - Session 40

- **Cause**: Bot had HP=10, hunger=0 while underground (Y=52) at midnight. Skeleton/zombie nearby. No food. HP likely hit 0 from starvation + hostile damage.
- **Location**: (3.7, 52.5, -2.7) underground cave
- **Coordinates**: (3.7, 52.5, -2.7)
- **Last Actions**:
  1. HP=10, hunger=0, midnight, Y=52 underground, 3 hostiles nearby
  2. `bot.flee()` → succeeded but still at Y=52
  3. `bot.pillarUp(5)` → ended up in water
  4. `bot.navigate("crafting_table")` — connection closed
  5. Respawned at (77.5, 67, -16.5) with HP=17.5, hunger=14
- **Root Cause**: Starvation + being underground + hostile mobs = death. Need to ensure food supply before going underground.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded.

---

## [2026-03-23] Bug: bot.gather() infinite hang - Session 40

- **Cause**: `bot.gather("birch_log", 20)` timed out after 120s. Likely caused by pathfinder being unable to navigate due to heavily excavated terrain (holes everywhere). The gather function found a target block but pathfinder could not compute a valid path.
- **Location**: (77.5, 67, -16.5) birch_forest
- **Coordinates**: (77.5, 67, -16.5)
- **Last Actions**:
  1. Session started: connected, HP=17.5, hunger=14, day
  2. `bot.gather("birch_log", 20)` — hung for 120s then timed out
  3. Bot did not move (same position before and after)
- **Root Cause**: Pathfinder deadlock due to terrain holes. gather() has no timeout fallback for when pathfinding is blocked.
- **Fix Applied**: None (game agent, report only)
- **Status**: Recorded. Using alternative approach: moveTo() to new area.

---

## [2026-03-23] Bug: Claude1 drowned - Session 39

- **Cause**: "Claude1 drowned" — Bot had HP=10, hunger=17 at position (8.3, 79, 13.7) in birch_forest. After equipping armor, tried bot.combat("cow") but no cow found. Bot somehow drowned — likely fell into water while searching for cow, or pathfinder navigated through water.
- **Location**: ~(8, 79, 13) birch_forest
- **Coordinates**: (8.3, 79, 13.7)
- **Last Actions**:
  1. Session started: HP=10, hunger=17, morning
  2. `bot.equipArmor()` — succeeded
  3. `bot.combat("cow", 8)` — returned "No cow found nearby"
  4. Death message: "Claude1 drowned"
- **Root Cause**: bot.combat() with no target found apparently still navigated/moved and the pathfinder moved the bot into water. The bot drowned while searching for a cow to hunt.
- **Fix Applied**: None (code fix prohibited for game agents)
- **Status**: Recorded. Respawned at (-8.5, 117, -9.5).

---

## [2026-03-23] Bug: Claude1 drowned underground - Session 38

- **Cause**: "Claude1 drowned" — Started session with HP=16.8, hunger=5, midnight, no food in inventory. Fled from hostiles, ended up underground at Y=44-55. Attempted to build shelter but pillarUp timed out (30s). Bot was underwater/in cave with 6 hostile mobs, HP=0.6, starvation made it impossible to regenerate. Drowned while trying to place blocks.
- **Location**: ~(-1.5, 44, -8.7) underground cave
- **Coordinates**: (-1.5, 44, -8.7)
- **Last Actions**:
  1. Session started: HP=16.8, hunger=5, midnight, 8 hostiles nearby, NO food in inventory
  2. `bot.flee(30)` → HP dropped to 0.6 during flee
  3. `bot.pillarUp(6)` → timed out after 30s (likely blocked underground)
  4. `bot.flee(50)` → Only moved 9/50 blocks, terrain constrained, now at Y=55
  5. Navigate to chest failed - path blocked underground
  6. `bot.place()` shelter attempt → timed out, bot drowned
- **Root Cause**: Session resumed with critical hunger=5 and no food in inventory at midnight. The critical HP drop happened during flee (before flee: unknown, after: 0.6). The flee tool dropped HP from ~16.8 to 0.6 - possibly ran into hostile during flee? Or hunger damage during flee? Navigation sent bot underground where it couldn't escape.
- **Fix Applied**: None (code fix prohibited for game agents)
- **Status**: Recorded. Death by drowning at Y=44. Respawned.

---

## [2026-03-22] Bug: bot.gather() が iron_ore/iron_ingot を取得できない

- **Cause**: `bot.gather("iron_ore", N)` および `bot.gather("iron_ingot", N)` が即時終了し、0個しか収集できない。インベントリに変化なし。
- **Location**: src/tools/core-tools.ts (gather実装)
- **Coordinates**: (4.5, 94.9, 32.5)
- **Last Actions**:
  1. `bot.gather("iron_ore", 10)` → 47ms で終了、0個
  2. `bot.gather("iron_ore", 5)` → 43ms で終了、0個
  3. `bot.craft("iron_pickaxe", 1, true)` → autoGather でも iron_ingot 0/3
- **Fix Applied**: なし（コード修正禁止のため記録のみ）
- **Status**: Investigating

---

## [2026-03-22] Bug: bot.navigate() 座標指定で移動しない（夜間 HP=10 Hunger=0）

- **Cause**: `bot.navigate({x, y, z})` を呼び出しても現在位置から動かない。夜間(midnight ticks=22193)、HP=10、Hunger=0の状態。同じ座標(-32, 97, 13)に留まり続ける。
- **Location**: src/tools/core-tools.ts (navigate実装)
- **Coordinates**: (-32.3, 97, 13) old_growth_birch_forest
- **Last Actions**:
  1. 接続後にflee(20) → 17秒かかって同エリアに留まる
  2. navigate({x:-6, y:98, z:4}) → 27.8 blocks awayエラー（チェストから離れすぎ）
  3. navigate({x:-35, y:98, z:9}) → 3秒で完了するが位置変わらず
  4. navigate({x:-20, y:97, z:13}) → 20秒タイムアウト後も位置変わらず
- **Fix Applied**: None（コード修正禁止）
- **Status**: 調査中。夜間のHP/移動ガードが原因の可能性。

---

## [2026-03-22] Bug: Claude1 moveTo完全不動 - (28.7, 69.2, 16.9)でスタック

- **Cause**: moveTo/navigate/flee(repeat)が全て(28.7,69.2,16.9)から動かない。flee()一回は動くが2回目以降は同座標。pathfindingが何かにブロックされていると思われる。
- **Location**: (28.7, 69.2, 16.9) birch_forest
- **Coordinates**: (28.7, 69.2, 16.9)
- **Last Actions**: flee(20)→28.7,69→moveTo(50,70,50)→動かず→flee x5→全て同座標
- **Fix Applied**: None (コード修正禁止)
- **Status**: 調査中。HP=9.2, Hunger=8, 食料ゼロで生存危機。

---

## [2026-03-22] Bug: Claude1 溺死 - moveTo(0, 72, 80)が水中y=114に誘導

- **Cause**: `bot.moveTo(0, 72, 80)` を呼んだところ、bot がy=114の水中に誘導された。水中で溺死。
- **Location**: (9, 114, 1) - 水中
- **Coordinates**: (9, 114, 1)
- **Last Actions**: flee(30) → moveTo(0, 72, 80) → 到達後y=114水中 → 溺死
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡。keepInventoryによりアイテム保持。moveTo が水中経路を選択するバグ要調査。

---

## [2026-03-22] Bug: Claude1 HP 0.2 瀕死 - 食料ゼロ+飢餓ダメージ+密集モブで詰み状態

- **Cause**: セッション開始時から食料ゼロ。HP 17.2→14.2→8.2→4.2→0.2と連続ダメージ。スケルトン矢+飢餓ダメージ+移動中の落下で瀕死に。moveTo失敗でパスがブロックされ、地下のY=79-82エリアから脱出できない。
- **Location**: (-1, 80, 7) birch_forest
- **Coordinates**: (-1, 80, 7) / 現在HP=0.2
- **Last Actions**: mc_flee(20) → 12.8m逃げた → moveTo(chest) → path blocked → 飢餓ダメージ → HP 0.2
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡確認（"hit the ground too hard"）。リスポーン後HP=17.7/Hunger=20に。keepInventoryでアイテム保持。移動中にY=78から落下死。

---

## [2026-03-22] Bug: Claude1 スケルトンに射殺 - 朝なのに大量スケルトンが消えず、hunger=0でHP回復不可

- **Cause**: 夜間に(birch_forest、Y=60-72の地下・木の日陰エリア)スケルトンが7-10体周囲に密集。朝になっても木の日陰で燃えず消えない。hunger=0でHP回復不可能。mc_flee(50)でも3-8ブロックしか逃げられない（地形制約）。mc_build("shelter")がtimeout（60秒）して完了しない間にスケルトンに射殺。
- **Location**: (-0.5, 72, -9.5) birch_forest
- **Coordinates**: 死亡座標 (-0.5, 72, -9.5)。リスポーン後 (-0.6, 102, 13.5)
- **Last Actions**: 1. mc_flee(20) x3 → 数ブロックしか逃げられず 2. mc_build("shelter") → 60秒タイムアウト → その間にスケルトンに射殺
- **Fix Applied**: None (コード修正禁止)
- **Status**: 記録済み。教訓: hunger=0状態で夜間/朝の密集スケルトンエリアに居続けるのは致命的。mc_build がtimeoutするリスクが高い。代わりにcobblestoneを手動でplaceしてシェルターを構築すべき。

---

## [2026-03-22] Bug: craft("white_bed") がウールからのレシピではなく色変えレシピ（white_dye+black_bed）を選択

- **Cause**: `bot.craft("white_bed", 1, false)` が本来のベッドクラフトレシピ（white_wool x3 + planks x3）を使わず、色変えレシピ（white_dye x1 + black_bed x1）を選択してしまった。インベントリにwhite_wool x4があったにもかかわらず、black_bedが存在しないとして失敗。
- **Location**: `src/tools/core-tools.ts` — craft関数のレシピ選択ロジック。ベッドのような複数レシピがあるアイテムで間違ったレシピを優先している。
- **Coordinates**: (2, 66, -5) birch_forest, 作業台 at (3, 65, -4)
- **Last Actions**: `bot.craft("white_bed", 1, false)` — white_wool x4所持・作業台隣接 → 色変えレシピを選択して失敗
- **Fix Applied**: None (コード修正禁止)
- **Status**: Recorded. 回避策: `bot.craft("bed", 1, false)` または `autoGather=false` で明示的にウールからのレシピを使う試みをする。

---

## [2026-03-22] Bug: Claude1 クリーパーに爆殺 - 夜間mc_flee不十分+minecraft_pillar_up失敗

- **Cause**: 夜間にHP 9.3、食料なしの状態でクリーパーに爆破された。mc_flee(distance=30)を2回呼んでも6ブロックしか逃げられなかった。minecraft_pillar_up(height=15)も1.2ブロックしか上がれず逃げ場なし。
- **Location**: (2, 64, -3) birch_forest
- **Coordinates**: (2, 64, -3)
- **Last Actions**: mc_flee(30) x2 → 6ブロックしか逃げられず → minecraft_pillar_up(15) → 1.2ブロックのみ → クリーパーに爆殺
- **Fix Applied**: None - keepInventoryでアイテム保持。
- **Status**: 死亡確認。mc_fleeが短距離しか逃げられないバグ要調査。

---

## [2026-03-22] Bug: minecraft_pillar_up 繰り返し失敗

- **Cause**: minecraft_pillar_up が cobblestone/birch_planks 装備時に "Placement failed" で1ブロックしか上がれない。cobblestoneをmc_equipで手に持ってから試みても同様の失敗。
- **Location**: (-14, 66, 34) old_growth_birch_forest
- **Coordinates**: (-14, 66, 34)
- **Last Actions**: mc_equip(cobblestone) → minecraft_pillar_up(height=15) → "Pillared up 1.0 blocks, Placement failed"
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Investigating. Bot stuck at Y=66, cannot reach chests at Y=89-90.

---

## [2026-03-22] Bug: Claude1 瀕死 - 飢餓+夜間ゾンビダメージ (Phase 2セッション)

- **Cause**: Phase 2食料確保中、草壊し(short_grass)でmc_gatherが120秒タイムアウト。その間に夜になりゾンビに攻撃されHP 6→4→3まで低下。hunger 0で飢餓ダメージも受け始め、HP 3で瀕死。食料がインベントリに全くなく回復不可能。
- **Location**: (-12, 63, 33) old_growth_birch_forest
- **Coordinates**: (-12, 63, 33)
- **Last Actions**: mc_gather(short_grass) timeout → mc_flee(zombie) → HP 4 → hunger 0 → HP 3瀕死
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 瀕死状態。食料確保が急務。

---

## [2026-03-22] Bug: mc_gather タイムアウト (birch_log / coal_ore)

- **Cause**: mc_gather が "coal_ore" と "birch_log" で連続して120秒タイムアウト。nearby_resources には両方 "nearby" と表示されているが採掘できない。
- **Location**: (6, 99, 70) old_growth_birch_forest
- **Coordinates**: (6, 99, 70)
- **Last Actions**: mc_navigate(coal_ore) → timeout, mc_navigate(birch_log) → timeout
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Investigating. Suspected: block is shown nearby but path is blocked (y-level mismatch or terrain obstacle).

---

## [2026-03-22] Bug: Claude1 killed by Creeper during Phase 2 food gathering

- **Cause**: mc_farm caused bot to roam into dangerous terrain at night. HP dropped to 3 due to mob damage during farming. mc_flee executed but Creeper explosion killed bot at HP 3. Multiple hostile mobs (creeper x4, skeleton, zombie x3, enderman, pillager x2, drowned x2) surrounded the area.
- **Location**: (4, 67, -3) birch_forest
- **Coordinates**: (4, 67, -3)
- **Last Actions**: mc_farm (seed planting near water) → mc_flee from creeper → death
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Death caused by nighttime roaming during mc_farm with no armor. Needs respawn.

---

## [2026-03-22] Bug: Claude1 HP 4 - mc_farm失敗でファームランド変換できず食料確保不能

- **Cause**: mc_farm実行時に水源近くのdirtをtillしてもfarmlandに変換されない（"NOT farmland — skipping"）。農場が機能せず食料が得られないままHP 4まで低下。
- **Location**: (-3, 89, -2) birch_forest
- **Coordinates**: (-3, 89, -2)
- **Last Actions**: mc_farm → till失敗(farmland変換されない) → HP 4 → 食料ゼロ → 回復不可
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 緊急。食料ゼロ、HP 4。動物狩りで食料確保必須。

---

## [2026-03-22] Bug: mc_combat がスケルトン相手に必ずタイムアウト

- **Cause**: `bot.combat("skeleton", 5)` を呼ぶと、30秒・60秒どちらのタイムアウトでも常にタイムアウトエラーになる。戦闘が完了せず、スケルトンも倒せない。朝（tick 5093）でも消えないスケルトンが10m圏内にいて、mc_navigate/mc_farm もそのスケルトンをブロックとして移動拒否される。
- **Location**: `src/tools/core-tools.ts` — combat関数のattackループ
- **Coordinates**: (3, 64, 13) birch_forest
- **Last Actions**: bot.flee(25) → skeleton 10.8mまで逃げた → bot.navigate({x:60,y:63,z:4}) → ABORTED (skeleton 10.8m) → bot.combat("skeleton", 5) → 30秒timeout → bot.combat("skeleton", 5) → 60秒timeout
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 調査中。mc_combatのattackループが終わらない。fleeHp=5でも戦闘が始まらずタイムアウト。移動と農場作りも全てブロックされている。

---

## [2026-03-22] Bug: Claude1 shot by Skeleton during midnight

- **Cause**: Claude1 was killed by a Skeleton during midnight. No armor equipped, nighttime mob encounter while navigating.
- **Location**: Unknown (observed via chat: "Claude1 was shot by Skeleton")
- **Coordinates**: Unknown
- **Last Actions**: Navigating during midnight, no armor
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Claude1 died to Skeleton at midnight. Claude2 also at HP 7.5 before fleeing.

---

## [2026-03-22] Bug: Claude1 HP 1 with no food - imminent death risk

- **Cause**: Session started with HP 4 and zero food. No animals found within 200 blocks. HP dropped to 1 due to mob attacks during night. No recovery path available (hunger 7, no food items, no animals).
- **Location**: (1, 51, 10) birch_forest
- **Coordinates**: (1, 51, 10)
- **Last Actions**: mc_flee x1, mc_navigate to furnace (failed), mc_navigate to find cow/chicken/pig (all failed within 200 blocks)
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Investigating. Bot at HP 1, food=0, hunger=7. Attempting to survive by staying still and finding alternative food source.

---

## [2026-03-22] Bug: Claude1 Death - HP 1.2 mob attrition, no food, no escape path

- **Cause**: HP dropped from 5.3 to 1.2 through continuous mob damage (14+ mobs surrounding: creepers x5, skeletons x3, pillager x2, drowned x1, enderman x1, zombie x2). No food in inventory. mc_flee failed to escape (only moved 8-12 blocks each attempt). mc_navigate blocked in all directions due to terrain. Safety check blocked all movement at HP <2. Bot died from mob damage.
- **Location**: (2, 75, -2) birch_forest
- **Coordinates**: (2, 75, -2)
- **Last Actions**: mc_flee x3 (insufficient distance) → mc_navigate(100,75,100) blocked → mc_navigate(-100,64,100) safety check blocked → death
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Respawned at (-10, 109, 9) with near-empty inventory (2 dirt only, all tools lost). Root cause: persistent extreme mob density at spawn area with no food supply.

---

## [2026-03-22] Bug: Claude1 Death - 夜間クリーパー/モブ被弾, HP 5.8から20に回復

- **Cause**: 夜間にmc_navigate中にHP 20→5.8に低下。クリーパー・スケルトン・エンダーマン等4体に囲まれた。mc_flee(30)を実行したが十分に逃げられず(9ブロックのみ)。minecraft_pillar_up(8)も失敗(1.1ブロックのみ)。その後HPが5.8→20に回復（keepInventory有効、おそらく死亡してリスポーン）。
- **Location**: (-8, 92, -2) birch_forest
- **Coordinates**: (-8, 92, -2)
- **Last Actions**: mc_navigate(crafting_table) → HP 5.8 → mc_flee(30) 不十分 → minecraft_pillar_up(8) 失敗 → 死亡推定→リスポーン
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Root causes: (1) mc_flee距離不十分バグ継続, (2) minecraft_pillar_up失敗継続, (3) 食料ゼロで夜間行動。

---

## [2026-03-23] Bug: bot.moveTo がY=38まで地下に潜行 - pathfinderが洞窟経路を選択

- **Cause**: セッション開始時にY=58の地下に出現（前回の飢餓死からのリスポーン後）。bot.moveTo(50,69,0)→bot.moveTo(0,69,50)→bot.moveTo(-50,69,0)→bot.moveTo(17,69,-16) を繰り返しても、Y=58→60→52→50→51→38と深くなった。目標Y=69-80なのに実際はどんどん下降する。
- **Location**: 洞窟内、birch_forest
- **Coordinates**: 最終 X=9, Y=38, Z=~ (いずれもY=57~58から開始)
- **Last Actions**: bot.moveTo(50,65,0) → Y=65到達せず(Y=65になったと思われたが次の確認でY=52) → bot.moveTo(0,69,50) → Y=58 → bot.moveTo(-50,69,0) → 同座標 → bot.moveTo(17,69,-16) → Y=38に降下
- **Root Bug**: pathfinderが地表へのルートを計算できず、洞窟を通って目標XZ座標に向かうルートを選択している。Y=58から地表Y=70までの直接経路がブロックされているため洞窟系を進み、それが深くなる方向の洞窟分岐を選んでしまう。
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 地下に閉じ込められた状態。bot.pillarUp()は"No blocks placed"で失敗（cobblestone 78個所持にもかかわらず）。地表脱出方法が不明。

---

## [2026-03-23] Bug: Claude1 溺死 - 地下洞窟で水に落ちて死亡

- **Cause**: Y=38の地下洞窟内でbot.moveTo/navigateを実行中に水源に落ちて溺死。"Claude1 drowned"がサーバーメッセージで確認。地下洞窟には水源が多く、pathfinderが水中経路を選択した結果と思われる。
- **Location**: 地下洞窟、birch_forest周辺
- **Coordinates**: 死亡前 X=7.5, Y=38前後, Z=不明 → リスポーン (7.5, 100, -3.5)
- **Last Actions**: bot.moveTo(17,69,-16) → Y=38に降下 → 洞窟内移動中 → 溺死（バグ記録執筆中に発生）
- **Root Bug**: moveTo が地下洞窟の水源ルートを選択してbotを水中に誘導。以前にも同様のバグ(moveTo(0,72,80)でy=114水中に誘導)が報告されており、繰り返し発生している。
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 死亡確認。keepInventoryでアイテム保持。リスポーン後 Y=100, HP=20, Hunger=20。

---

## [2026-03-22] Bug: Claude1 slain by Zombie while navigating to pig

- **Cause**: mc_navigate sent bot toward pig at Y=101 in hilly terrain. While navigating through elevated/obstructed terrain, Zombie attacked and killed bot. Iron boots lost (armor not restored by keepInventory? Or dropped on death).
- **Location**: ~(6, 105, 1) birch_forest
- **Coordinates**: (6, 105, 1)
- **Last Actions**: mc_navigate to pig coordinates (-51, 101, 93), path blocked, Zombie appeared during navigation.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true but iron_boots missing after respawn. Proceeding with Phase 2.

---

## [2026-03-22] Bug: Claude1 shot by Skeleton at Y:38 underground - Phase 2 session

- **Cause**: Bot fell deep underground (Y:38) while navigating around blocked terrain. Surrounded by extreme mob density at night (pillagers, skeletons, creepers, endermen, zombies). HP dropped to 9 with no food. mc_build(shelter) was called but skeleton killed bot during construction.
- **Location**: (-3, 38, 14) birch_forest
- **Coordinates**: (-3, 38, 14)
- **Last Actions**: mc_navigate (multiple blocked) → mc_flee → minecraft_pillar_up (failed - placement failed) → mc_gather oak_log (120s timeout) → mc_build(shelter) → killed by skeleton during construction
- **Root Cause**: minecraft_pillar_up "placement failed" bug prevents escaping deep underground. Once underground at night, mob density becomes lethal.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Respawned at (-9, 112, 6) with inventory intact. minecraft_pillar_up failure is a repeated bug that needs investigation.

---

## [2026-03-22] Bug: Claude1 near-death from starvation/creeper - Phase 2 start

- **Cause**: Bot started session with HP 0.1 and no food. hunger dropped to 2. Creeper approached at 15 blocks while at HP 0.1. mc_flee triggered. Suspected respawn occurred (HP/hunger jumped to 20/20 after flee).
- **Location**: ~(7, 92, 8) birch_forest
- **Coordinates**: (7, 92, 8)
- **Last Actions**: mc_flee x2 from creeper. After second flee, HP/hunger restored to 20/20 - likely respawn triggered.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true. Now at full HP/hunger, proceeding with Phase 2.

---

## [2026-03-22] Bug: Claude1 shot by Skeleton - Phase 2 attempt

- **Cause**: Bot navigated underground while searching for crafting table. Y dropped from 98 to 85. Skeleton found bot underground, shot and killed while HP was already low (8/20). mc_navigate pathfinder chose underground cave route.
- **Location**: ~(7, 85, 8) birch_forest
- **Coordinates**: (7, 85, 8)
- **Last Actions**: Crafted bone_meal, navigated to crafting table, fell into cave system. Skeleton attacked at night with HP already at 8 from travel damage.
- **Fix Applied**: None yet. Root cause: mc_navigate sometimes routes through caves. Need to stay above Y=90 at night.
- **Status**: Recorded. keepInventory=true, respawned with all items.

---

## [2026-03-22] Bug: Claude1 drowned - Session 44

- **Cause**: mc_navigate fell bot into underground water while pathfinding to coordinates (100, 96, 0). Bot ended up at Y=72 underwater with 0 hunger, surrounded by mobs. Drowned.
- **Location**: ~(15, 72, 3) birch_forest
- **Coordinates**: (15, 72, 3)
- **Last Actions**: Trying to navigate to surface/find animals for food. mc_navigate sent bot underground through cave system instead of staying on surface. Hunger reached 0 with no food available.
- **Fix Applied**: None - navigation pathfinding issue sends bot underground via caves
- **Status**: Recorded. Respawned with full HP/hunger. keepInventory=true.

---

## [2026-03-22] Bug: Claude1 doomed to fall by Phantom - Session 43

- **Cause**: Claude1 was killed by a Phantom. Phantoms spawn when a player hasn't slept for 3+ nights. Bot does not sleep regularly, accumulating "insomnia" counter.
- **Location**: Unknown (observed via server message)
- **Coordinates**: Unknown
- **Last Actions**: Operating at night (midnight, tick ~20233). Phantom attacks from above, hard to flee.
- **Fix Applied**: None yet. Root cause: no sleep → Phantom spawns. Need to sleep every night or avoid being outside at night.
- **Status**: Recorded. keepInventory=true so items preserved.

---

## [2026-03-22] Bug: Claude1 slain by Skeleton - Session 42

- **Cause**: HP dropped to 0.8 at night (tick ~17633). Had no food. Skeleton attacked from south. Flee didn't create enough distance. Pillar attempt failed initially (no solid ground check), then succeeded at different location but too late - bot had already died/respawned at Y:121.
- **Location**: ~(22, 42, -3) birch_forest
- **Coordinates**: (22, 42, -3)
- **Last Actions**: Tried to craft white_bed, craft chain failed trying to make bone. Navigated to crafting table, multiple hostile mobs (skeleton x2, creeper, enderman, zombie) cornered bot. Fleeing didn't help, pillar-up failed first attempt.
- **Fix Applied**: None yet. Root cause: night survival with 0 hunger + 0 food + multiple mobs. Need to stay indoors at night.
- **Status**: Recorded. Respawned with full HP/hunger. keepInventory=true.

---

## [2026-03-22] Bug: Claude1 slain by Zombie at Y=86 - mc_flee insufficient distance

- **Cause**: Bot navigated to Y=86 (underground/hillside) where 4 hostile mobs were present in daytime. mc_flee executed 3 times but distance was insufficient (10, 1.8, 20 blocks). Zombie killed bot after third flee. No food to heal, no armor.
- **Location**: (~-10, 86, 4) birch_forest
- **Coordinates**: (-10, 86, 4)
- **Last Actions**: bucket fill failed x3 → mc_status showed threats at Y=86 → mc_flee x3 → death
- **Fix Applied**: None. Root cause: pathfinding drops bot to low Y where mobs concentrate. mc_flee doesn't always escape in correct direction.
- **Status**: Recorded. Respawned at (-10, 108, 5). keepInventory=true.

---

## [2026-03-22] Bug: Claude1 shot by Skeleton during mc_navigate to water - Phase 2 farming

- **Cause**: mc_navigate to water at (12, 101, 10) for farming setup. Navigation returned "Path blocked" but during navigation attempt, skeleton killed Claude1. Bot was at Y=86 when killed, likely caught by skeleton during pathfinding.
- **Location**: (~-10, 86, 4) birch_forest
- **Coordinates**: (-10, 86, 4)
- **Last Actions**: mc_farm (planted 2 seeds near water, HP dropped to 17) → mc_navigate(12,101,10) → "Claude1 was shot by Skeleton"
- **Fix Applied**: None - recording only. Root cause: no armor, skeleton attacked while pathfinding near Y=86 cave area.
- **Status**: Recorded. Respawned at Y=116 with full HP/hunger. keepInventory=true. Items intact.

---

## [2026-03-22] Bug: Claude1 死亡 - 洞窟内飢餓+モブ包囲

- **Cause**: mc_navigateが繰り返し地下洞窟ルートを選択。Y=70-74の洞窟内でHP9腹0の状態で多数のモブ（クリーパー2体・ゾンビ・ピリジャー・スケルトン）に包囲。pillar_upも洞窟天井で失敗。脱出不可能で死亡と推定（ステータスがHP14.3腹20に突然変化→リスポーン）。
- **Location**: (-5~-22, 70-74, -14~-22) birch_forest 洞窟内
- **Coordinates**: (-22.4, 73.9, -22.3) 最後の確認位置
- **Last Actions**: 洞窟内でpillar_up失敗 → mc_flee → mc_navigate失敗を繰り返し → 死亡リスポーン
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true。リスポーン後HP14.3腹20でY=92地上に出現。

---

## [2026-03-22] Bug: Claude1 死亡 - 朝HP10腹0、モブ包囲で脱出失敗

- **Cause**: 接続時HP10/hunger0の状態。朝(ticks=2553)にもかかわらず周囲にCreeper・Skeleton・Zombie・Endermanが密集。flee()を複数回試みるも逃げられず。食料もなくHP4.5まで低下。pillarUp()が30秒タイムアウト。その後HP2に低下し死亡リスポーン（HP20/hunger20に変化）。
- **Location**: (~-5, 92, -5) old_growth_birch_forest
- **Coordinates**: (-1.5, 89, 9.6) 最低HP確認位置
- **Last Actions**: bot.flee(20) x2 → bot.moveTo(南方向) 失敗 → bot.flee(25) → HP2 → bot.pillarUp(5) タイムアウト → 死亡リスポーン
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. keepInventory=true。リスポーン後HP20/hunger20。朝でもモブが大量出現する原因は不明（難易度設定？biome特性？）。

---

## [2026-03-22] Bug: Claude1 HP9腹0 多数モブ包囲 - Phase 2 Session (current)

- **Cause**: mc_navigateが地下洞窟を通るルートでボットがY=73まで降下。クリーパー・ピリジャー・スケルトン2体に包囲。HP9、腹0で飢餓ダメージ進行中。食料なし、動物なし。チェストへのパスが全てブロックされ食料補充不可。
- **Location**: (-6.4, 73, 1.5) birch_forest
- **Coordinates**: (-6.4, 73, 1.5)
- **Last Actions**: mc_navigate → 地下洞窟経由で降下 → 多数のモブに包囲 → mc_flee → チェスト到達不可
- **Fix Applied**: None - recording only per user instruction.
- **Status**: 危険状態。地表へ上がる必要あり。mc_navigateが繰り返し地下洞窟ルートを選択する根本バグあり。

---

## [2026-03-22] Bug: Claude1 slain by Phantom + fell from high place - Phase 2 Session (current)

- **Cause**: Phantom attacked Claude1 during daytime farming operation at ~(20, 103, 29). Phantoms spawn when a player has not slept for 3+ game nights. Bot does not sleep regularly. After Phantom hit, bot fell from high place (was on elevated terrain). Double death event: "Claude1 was slain by Phantom" then "Claude1 fell from a high place".
- **Location**: ~(20, 103, 29) birch_forest
- **Coordinates**: (20.5, 103, 29.5) approximate
- **Last Actions**: mc_farm (planting/tilling near water at 16,102,20) → Phantom attacked → fell from elevation → death
- **Fix Applied**: None yet. Root cause: no sleep between nights → Phantom insomnia timer maxes out. Need mc_sleep every night before tick 12541.
- **Status**: Recorded. Respawned at (-1.5, 88, 1.5) with inventory intact (keepInventory=true). HP 16.3, hunger 16. Multiple threats at respawn: pillager(15.8), zombie(12.4), enderman(14.5).

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 41

- **Cause**: HP dropped to 8 at night (midnight) with no food. Was navigating rugged old_growth_birch_forest terrain trying to reach base chest. Zombie killed bot before reaching safety.
- **Location**: ~(-9, 114, -8) old_growth_birch_forest
- **Coordinates**: (-9.0, 114.0, -8.0)
- **Last Actions**: Navigating to chest at (-9, 99, 4) to get food. Multiple navigate failures due to path blocked. Killed by zombie at midnight.
- **Fix Applied**: None. Root cause: low HP + no food + night navigation in rugged terrain.
- **Status**: Recorded. Respawned with full HP/hunger at (8, 87, 6). keepInventory=true.

---

## [2026-03-21] Bug: Claude1 drowned - Session 40b (observed by Claude2)

- **Cause**: "Claude1 drowned" — Claude1 drowned after respawning from zombie death. Likely fell into water while navigating.
- **Location**: Unknown
- **Coordinates**: Unknown
- **Last Actions**: Claude1 had just respawned after zombie death. Was navigating east to hunt cows.
- **Fix Applied**: None. Root cause: respawn position + navigation at night near water.
- **Status**: Recorded by Claude2.

---

## [2026-03-25] Bug: moveTo() completely fails - bot stuck at same position - Session (current)

- **Cause**: bot.moveTo() called with various targets (nearby 5-100 blocks) but bot never moves. Position stays at (-10, 81, 13) regardless of target. creeper×4, zombie×2, enderman×1 nearby. Hunger=0, HP=10.
- **Coordinates**: (-10, 81, 13)
- **Last Actions**: moveTo(px+20, py, pz+20) → stayed at same pos. moveTo(px+100, py, pz+100) → same. moveTo(south -Z 50) → same. All 5 step-moves (5 blocks each) failed.
- **Error**: No error thrown, but position unchanged after moveTo completes.
- **Root Cause**: Unknown. Possibly pathfinder blocked by terrain/mob density. Bot is in old_growth_birch_forest at Y=81 with creepers surrounding. flee() also fails to move bot.
- **Impact**: Bot completely immobile. Cannot hunt food, gather logs, or escape enemies.
- **Fix Needed**: moveTo/flee should detect when bot is truly stuck (position unchanged after timeout) and try alternative strategies (pillarUp, dig path, teleport-style movement).
- **Status**: Reported. Session current. Hunger=0 HP=10. BLOCKING.

---

## [2026-03-22] Bug: mc_reload triggers full process restart instead of hot module reload

- **Cause**: mc_reload always responds with "Full hot-reload complete (process restart)" instead of performing a module-level hot reload. This means the bot disconnects and reconnects on every call, causing disruption to gameplay.
- **Location**: src/index.ts (mc_reload handler) / SIGUSR1 handler
- **Coordinates**: N/A
- **Last Actions**: Called mc_reload to initialize registry.highLevel so bot.craft() could work.
- **Root Cause**: Suspected: mc_reload sends SIGUSR1 to itself, which triggers process restart in the MCP server launcher. Or the reload handler itself restarts the process.
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Impact: registry.highLevel is never initialized on startup → bot.craft() always fails.

---

## [2026-03-22] Bug: registry.highLevel undefined on startup - bot.craft() always fails

- **Cause**: index.ts does not import high-level-actions.ts at startup. registry.highLevel is only populated when high-level-actions.ts is imported. Since index.ts never imports it directly, registry.highLevel remains undefined until mc_reload is called — but mc_reload restarts the process, which resets registry again.
- **Location**: src/index.ts (missing import of high-level-actions)
- **Coordinates**: N/A
- **Last Actions**: Called bot.craft('white_bed', 1, false) — error: "Cannot read properties of undefined (reading 'minecraft_craft_chain')"
- **Fix Applied**: None - recording only per user instruction.
- **Status**: Recorded. Workaround: use lower-level mineflayer craft API directly in mc_execute if possible.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 40 (observed by Claude2)

- **Cause**: "Claude1 was slain by Zombie" — Claude1 was hunting cows east of base at night.
- **Location**: Unknown (east of base, birch_forest area)
- **Coordinates**: Unknown
- **Last Actions**: Claude1 was reported to be heading east to hunt cows. It was nighttime (tick ~15933).
- **Fix Applied**: None. Root cause: navigating/hunting at night without sufficient armor/food protection.
- **Status**: Recorded by Claude2. keepInventory=true so items preserved.

---

## [2026-03-21] Bug: Claude1 fell from high place at spawn - Session 39

- **Cause**: "Claude1 fell from a high place" — Respawned at y=123, fell while stationary (possibly from trying to craft at high elevation).
- **Location**: ~(-9, 123, 5) spawn area
- **Coordinates**: (-9.0, 123.0, 5.0)
- **Last Actions**: Respawned at y=123 after zombie death. Tried mc_sleep (no bed), tried mc_craft (bed), fell during craft attempt.
- **Fix Applied**: None. Root cause: spawn point is at y=123, bot falls off edge when idle.
- **Status**: Recorded. Now morning (tick 1513). Continuing east safely.

---

## [2026-03-21] Bug: Claude1 slain by Zombie during night navigation - Session 38

- **Cause**: "Claude1 was slain by Zombie" — Navigating east at midnight (tick ~22213). Zombie attacked at ~(77, 82, -5) while path was blocked.
- **Location**: ~(77, 82, -5)
- **Coordinates**: (77.0, 82.0, -5.0) then respawn (-9, 123, 5)
- **Last Actions**: Navigating east from respawn at (-5, 100, -7). Path blocked multiple times, descended to y=82. Zombie killed bot.
- **Fix Applied**: None. Root cause: navigating at night with no armor (only iron_boots) and no food.
- **Status**: Recorded. Respawned at (-9, 123, 5). Waiting for dawn before navigating.

---

## [2026-03-21] Bug: Claude1 fell to death navigating east - Session 37

- **Cause**: Fall death while navigating around x=259, y=61, z=22 area. Path was blocked and bot fell into ravine/cliff when attempting alternate route.
- **Location**: ~(259, 61, 22)
- **Coordinates**: (259.1, 61.1, 22.0) then respawn (-5.3, 100, -7.7)
- **Last Actions**: Navigating east from x=144 toward cow at (333, 69, 64). Multiple hops at y=61-64. Tried shifting Z to get around obstacle. Fell.
- **Fix Applied**: None yet. Root cause: pathfinder descended to y=61 during east navigation, hit ravine area ~x=259.
- **Status**: Recorded. Respawned at (-5, 100, -7). It is midnight - must wait or navigate carefully.

---

## [2026-03-21] Bug: Claude1 slain by Zombie Villager - Session 36

- **Cause**: "Claude1 was slain by Zombie Villager" — Immediately after respawn at (0, 96, -1), navigated to x=100. Zombie Villager killed bot before reaching destination.
- **Location**: ~(0, 96, -1) spawn area
- **Coordinates**: (0.0, 96.0, -1.0)
- **Last Actions**: Respawned after Skeleton death. First navigate call to x=100. Death message appeared during navigation.
- **Fix Applied**: None. Root cause: Zombie Villager in spawn area, bot has no armor after respawn.
- **Status**: Recorded. Respawned. Continuing east.

---

## [2026-03-21] Bug: Claude1 shot by Skeleton - Session 35

- **Cause**: "Claude1 was shot by Skeleton" — Navigating east at ~x=108, Y=75, Z=6. HP was already low (6.8) with no food. Skeleton shot bot to death.
- **Location**: ~(108, 75, 6)
- **Coordinates**: (108.5, 75.0, 6.5)
- **Last Actions**: Repeated mc_navigate hops east through old_growth_birch_forest, all paths blocked. HP=6.8, no food in inventory.
- **Fix Applied**: None. Root cause: low HP + no food + skeleton in dense forest. Need to eat wheat or avoid prolonged blocked navigation near skeletons.
- **Status**: Recorded. Respawned. Continuing east.

---

## [2026-03-21] Bug: Claude1 slain by Drowned x2 - Session 34

- **Cause**: "Claude1 was slain by Drowned" — Navigating east at ~x=232, Y=61, Z=52. HP hit 0 while drowned were 6-7 blocks away. Second death: mc_flee triggered but Drowned killed bot before escape.
- **Location**: ~(232, 61, 52)
- **Coordinates**: (232.7, 61, 52.3)
- **Last Actions**: mc_navigate hops east, reached x=227, then moved to x=232. Status showed HP=0, two Drowned at 6-7 blocks. mc_flee executed but second death occurred.
- **Fix Applied**: None. Root cause: Y=61-62 near water/river, Drowned spawn. Need to route above Y=65 past x=200.
- **Status**: Recorded. Respawned at base. Continuing east.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 33

- **Cause**: "Claude1 was blown up by Creeper" — Just respawned, moving east at x=50, Y=91. Creeper exploded during navigate call.
- **Location**: ~(52, 91, 6)
- **Coordinates**: (52, 91, 6)
- **Last Actions**: Respawned from Drowned death, attempted mc_navigate to x=50.
- **Fix Applied**: None. Root cause: Creepers still present near base area. Night/dawn timing.
- **Status**: Recorded. Continuing east.

---

## [2026-03-21] Bug: Claude1 slain by Drowned - Session 32

- **Cause**: "Claude1 was slain by Drowned" — Navigating east at ~x=248-280, Y=62, Z=17. Drowned killed bot near river/water area.
- **Location**: ~(248-280, 62, 17)
- **Coordinates**: ~(260, 62, 17) estimated
- **Last Actions**: mc_navigate hops east from base toward cow at (333,69,64). Reached x=248, then next hop to x=280 triggered death.
- **Fix Applied**: None. Root cause: Y=62 near water level, Drowned spawn in rivers.
- **Status**: Recorded. Respawned. Continuing east.

---

## [2026-03-21] Bug: Claude1 slain by Drowned - Session 31

- **Cause**: "Claude1 was slain by Drowned" — Navigating east at night. Reached x=233 before a Drowned killed the bot. Likely in or near water.
- **Location**: ~(233, 61, 55)
- **Coordinates**: ~(233, 61, 55)
- **Last Actions**: mc_navigate hops east, reached x=213 then x=233. Next hop to x=265 triggered death message.
- **Fix Applied**: None. Root cause: Navigating at night through water/river areas where Drowned spawn. Y=61 is near water level.
- **Status**: Recorded. Respawned at (0.5, 97.4, 11.5). Continuing east.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 30

- **Cause**: "Claude1 was blown up by Creeper" — Bot had HP=6, navigating east at night through forest. Bot was moving in 20-block hops trying to reach cow at (333, 69, 64). A creeper exploded during mc_navigate call.
- **Location**: ~(180, 66, 40), birch_forest area, midnight
- **Coordinates**: ~(180, 66, 40)
- **Last Actions**: mc_navigate hops east → killed spider at (64, 80, 6) → continued east → blown up by creeper at ~x=180
- **Fix Applied**: None. Root cause: Navigating at night with low HP (6) through forest. Creeper snuck up during path execution. Lesson: Should either wait for day or keep HP > 10 at night to give more buffer.
- **Status**: Recorded. Respawned with keepInventory at (10, 97, -6), HP=20, Hunger=20.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 29

- **Cause**: "Claude1 was slain by Zombie" — Bot had HP=4.3, Hunger=13, night time, zombie 11.7m north. Agent had just loaded tools and read status but bot was already in critical HP at night with a zombie in close range. Bot died before any survival action could be taken.
- **Location**: (356, 64, 123), birch_forest
- **Coordinates**: (356, 64, 123)
- **Last Actions**: Previous session left bot at HP=4.3 at night with zombie nearby. Session started, checked chat, bot was already dead.
- **Fix Applied**: None yet. Root cause: Session resumed with bot at critically low HP (4.3) at night with mob in range. The bot should have pillar-upped or fled immediately at end of previous session before stopping. Lesson: Never end a session with HP < 8 at night without safety measures.
- **Status**: Recorded. Respawned with keepInventory.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 28

- **Cause**: "Claude1 was slain by Zombie" — Bot at Hunger=1, HP=14, traveling east through old_growth_birch_forest at night. mc_combat(zombie) killed 2 zombies but one hit the bot. With hunger at 1 and unable to regenerate HP, a zombie finally killed the bot.
- **Location**: Around (51-74, 73-79, -18 to -49) old_growth_birch_forest, midnight.
- **Coordinates**: Death at approximately (74, 73, -49) or nearby.
- **Last Actions**: mc_navigate east → mc_combat(zombie) x2 → mc_navigate(70, 75, -18) → slain by zombie.
- **Fix Applied**: None. Root cause: Bot navigating at night with critical hunger (1) and HP 14 with no food. Cannot regenerate HP. Any zombie hit is dangerous. Lesson: Do NOT navigate at night with critical hunger/HP. Either wait for day or use flee_at_hp higher to avoid zombie contact.
- **Status**: Recorded. Respawned with keepInventory at (-10, 114, 5), HP=20, Hunger=20.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 27

- **Cause**: "Claude1 was blown up by Creeper" — During mc_combat(zombie), a creeper at 11.8 blocks east exploded. The zombie combat caused movement that brought the bot near the creeper.
- **Location**: Around (-39, 74, -6) old_growth_birch_forest, night.
- **Coordinates**: Death during zombie combat at night.
- **Last Actions**: mc_status showed creeper 11.8 blocks east + spider 12.4 blocks north. Then mc_combat(zombie) → blown up by creeper.
- **Fix Applied**: None yet. Root cause: mc_combat doesn't flee from creepers before engaging zombies. Need to flee from creepers first, THEN engage zombies. Or: mc_combat should have flee_at_hp high enough to survive one hit, but creeper explosions are 1-shot from close range.
- **Status**: Recorded. Died, respawned with keepInventory at (-14, 100, -11).

---

## [2026-03-21] Bug: Claude1 fell from a high place - Session 26

- **Cause**: "Claude1 fell from a high place" — mc_navigate(x=10, y=116, z=4) caused fall. Bot was at y=116 surface, pathfinder tried to navigate and bot fell to y=86, losing ~5 HP.
- **Location**: Started at (-7, 116, 4), fell to (6, 86, -1) birch_forest.
- **Coordinates**: Fall from y=116 to y=86 = 30 block drop.
- **Last Actions**: Dropped junk items → mc_navigate(x=10, y=116, z=4) → fell off cliff.
- **Fix Applied**: None yet. Root cause: maxDropDown setting too permissive. The recent fixes (commits 5539442, 822389e) reduced maxDropDown to 1 but this fall still occurred. May need to investigate why pathfinder took a 30-block cliff path.
- **Status**: Recorded. HP now 14.8, no immediate danger.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 25

- **Cause**: "Claude1 was slain by Zombie" — Bot at 0.8 HP with no food, trying to navigate to chest at (-1, 88, -2). Zombie attacked during navigation and killed bot.
- **Location**: (-1.7, 103, -9.8) birch_forest, daytime.
- **Coordinates**: Death around (-1.7, 103, -9.8). Respawned at (-2.7, 94, 2.7).
- **Last Actions**: mc_navigate to chest → killed by zombie. HP was already 0.8 — critical. Had no food in inventory.
- **Fix Applied**: None. Root cause: After previous respawn (Session 24), bot took damage (likely fall damage from height 82 → 83 area, or hit by mob) before reaching safety. With 0.8 HP and no food, any mob contact = death. Lesson: After respawn, IMMEDIATELY check HP and navigate to chest for food. Do NOT explore with 0.8 HP.
- **Status**: Recorded.

---

## [2026-03-21] Bug: Claude1 blown up by Creeper - Session 24

- **Cause**: "Claude1 was blown up by Creeper" — Bot was at HP 11.2 with no food, attempted mc_combat(zombie) at dawn with creeper at 5.2 blocks east. mc_combat triggered flee but creeper exploded first.
- **Location**: (8.4, 73, -0.5) birch_forest at dawn/day transition.
- **Coordinates**: Death around (8, 73, -1). Respawned at (-0.5, 82, -3.4).
- **Last Actions**: mc_flee (from creeper at 5.4 blocks) → mc_combat(zombie, flee_at_hp=8) → "Fled! Health was 0. Attacked 0 times." — creeper exploded during flee.
- **Fix Applied**: None. Root cause: (1) No armor worn despite having iron_sword; (2) Engaged combat with creeper at close range (5 blocks) — must maintain 7+ block distance from creepers; (3) HP was already 11.2 before engagement. Lesson: NEVER approach creeper within 6 blocks. Always craft and equip armor before any mob combat.
- **Status**: Recorded.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 23

- **Cause**: "Claude1 was slain by Zombie" — Bot was at HP 0.6 with hunger 8, multiple zombies nearby after flee was too slow. mc_flee triggered but death occurred before escape completed.
- **Location**: Around (-118, 70, -59) old_growth_birch_forest at night.
- **Coordinates**: Death around (-118, 70, -59). Respawned at (-6, 114, -11).
- **Last Actions**: mc_combat(zombie, flee_at_hp=4) → fled at HP 3.1 → status showed 0.6 HP → mc_flee(30) → died during flee.
- **Fix Applied**: None yet. Root cause: flee_at_hp=4 threshold too low; zombie combat at critically low HP. flee_at_hp should be higher (6+) when starting HP is already low. Also: item collection bug — zombies defeated but no rotten_flesh dropped.
- **Status**: Recorded. Lesson: never engage zombies at night when HP < 7. flee_at_hp must be set relative to current HP, not absolute.

---

## [2026-03-22] Bug: bot.craft() fails silently - chest not crafted

- **Cause**: `bot.craft('chest', 2)` and `bot.craft('chest', 2, true)` both return "Crafted chest x2" but inventory shows no chest. Internal error logged: `TypeError: Cannot read properties of undefined (reading 'minecraft_craft_chain')`. The craft function catches the error from Attempt 1, falls back to something, reports success, but does not actually add items to inventory.
- **Location**: src/tools/core-tools.ts (craft implementation) - autoGather=false path
- **Coordinates**: (34, 60, 46) near crafting table
- **Last Actions**: Navigated to crafting table at (34,60,46). Called bot.craft('chest', 2) → no chest in inventory. Called bot.craft('chest', 2, true) → same result.
- **Fix Applied**: None (code fix prohibited per user instructions)
- **Status**: Investigating workaround. Will try mc_craft via autoGather=true path instead.

---

## [2026-03-22] Bug: Claude1 drowned - Session current

- **Cause**: "Claude1 drowned" — Bot was waiting at night (ticks 15653) at y=86 with hunger=0, HP=8.2. During 30s wait, bot drowned. Exact location of water unknown but bot was placed in or fell into water near y=86 area. After respawn HP=20, hunger=20 (keepInventory).
- **Location**: y=86 area near (15, 86, 12) birch_forest.
- **Coordinates**: Death around (15, 86, 12) or nearby water source.
- **Last Actions**: Built dirt walls → HP 8.2 hunger 0 → waited 30s → drowned.
- **Fix Applied**: None (code fix prohibited per user instructions).
- **Status**: Recorded. Root cause: Bot was in or near water when waiting. bot.wait() does not move bot to safety before waiting — it just halts for N ms. Need to ensure bot is on solid ground before waiting. Also: moveTo was blocked by hunger=0 guard, so bot could not escape water. The hunger=0 moveTo guard may be too aggressive — it prevented finding food.

## [2026-03-21] Bug: Claude1 shot by Skeleton while pillaring - Session 22

- **Cause**: "Claude1 was shot by Skeleton" — Bot was at HP 3.1 with hunger 0, tried to pillar up 15 blocks to reach base. Was shot by skeleton while exposed during pillar climb at night.
- **Location**: Around (19, 72, -40) birch_forest, pillaring up.
- **Coordinates**: Death around (19, 72-100, -40). Respawned at (21, 102, -19).
- **Last Actions**: mc_flee (skeleton), mc_combat(sheep) - no sheep found, minecraft_pillar_up(15) → killed by skeleton.
- **Fix Applied**: None. Root cause: attempted to pillar up at night while HP was critically low (3.1). Should have prioritized shelter/hiding instead of climbing.
- **Status**: Recorded. Lesson: with HP < 5 at night, do NOT pillar up. Find indoor shelter or dig into ground.

---

## [2026-03-21] Bug: Claude1 doomed to fall by Skeleton - Session 21b

- **Cause**: "Claude1 was doomed to fall by Skeleton" — Skeleton knockback caused fatal fall. Occurred during navigation at night while trying to return to base after spider death.
- **Location**: Around (-3, 68, -10) birch_forest during mc_navigate to chest at (-1, 88, -2).
- **Coordinates**: Was at (-3, 68, -10), respawned at (11, 108, 1).
- **Last Actions**: mc_navigate(x=-1, y=88, z=-2) to return to chest. Skeleton knockback caused fall. This is the 2nd consecutive death from night mobs.
- **Fix Applied**: None. Root cause: navigating at night in open terrain. Must NOT navigate at night. Must build emergency shelter when night falls.
- **Status**: Recorded. Lesson: when night arrives, stop all navigation and build immediate shelter.

---

## [2026-03-21] Bug: Claude1 slain by Spider during navigation - Session 21

- **Cause**: "Claude1 was slain by Spider" — Bot was navigating toward coordinates (-150 Z) at midnight when killed by a spider. Bot was navigating at night with multiple threats nearby (enderman, zombie, skeleton). Spider attack likely happened during movement through dark terrain.
- **Location**: Navigation through dark terrain at night without checking threats first.
- **Coordinates**: Death around (-6, 96, 1) birch_forest. Respawned at (-14, 82, -31).
- **Last Actions**: mc_navigate(x=2, y=92, z=-150) — navigating at midnight with multiple threats (enderman 9 blocks, zombie 13 blocks, skeleton 3 blocks nearby after death).
- **Fix Applied**: None yet — root cause is navigating at night in open terrain without threat awareness. Need to avoid long-distance navigation at night.
- **Status**: Recorded. Immediate action: flee to shelter, wait for dawn.

---

## [2026-03-21] Bug: Claude1 slain by Zombie - Session 20

- **Cause**: "Claude1 was slain by Zombie" — observed in chat. Bot was apparently attacked by a zombie and killed. This could indicate: (1) bot was caught outside at night without shelter, (2) mc_combat failed to handle a zombie encounter properly, or (3) pathfinder walked bot into a zombie spawn area.
- **Location**: Unknown — death location not recorded by this agent. Zombie kills are melee-based.
- **Coordinates**: Unknown at time of death. This agent was at (-1, 116, -35) when message appeared.
- **Last Actions**: Claude1 was slain by Zombie per server chat message at midnight.
- **Fix Applied**: Investigating — possible need for proactive zombie avoidance at night (threats detection + flee before combat).
- **Status**: Investigating

---

## [2026-03-21] Bug: Fall death near ravine - Session 19

- **Cause**: "Claude1 hit the ground too hard" — fatal fall near a ravine. Bot walked off cliff edge or pathfinder allowed a drop into ravine. Previous fix set `maxDropDown=0` during mc_flee, but bot may have fallen during normal navigation near ravine terrain.
- **Location**: Likely `src/bot-manager/bot-movement.ts` or `src/tools/core-tools.ts` mc_navigate — pathfinder maxDropDown may still allow falls during standard navigation near cliffs/ravines.
- **Coordinates**: Death location unknown (near ravine). Respawned at (-7, 103, -6) birch_forest biome.
- **Last Actions**: Normal gameplay near ravine area. Fall death, not flee-related.
- **Fix Applied**: Investigation needed — check if mc_navigate also needs maxDropDown restrictions near cliff terrain.
- **Status**: Investigating

---

## [2026-03-21] Bug: Fall death during mc_flee - Session 18

- **Cause**: `mc_flee()` calculates a horizontal flee target and uses pathfinder with `maxDropDown=2`. When fleeing in a direction with terrain drop-offs (caves, ravines, cliffs), the pathfinder descends 2 blocks at a time repeatedly until a fatal fall occurs. Bot was at Y=68-70 underground with witch (W) + skeleton (E) — fled into cave terrain and fell.
- **Location**: `src/bot-manager/bot-movement.ts` `flee()` function line ~1110
- **Coordinates**: Died near (8, 69, 11), respawned at (-5, 117, 4)
- **Last Actions**:
  1. mc_status — HP=3.5, witch at 11.7 blocks W, skeleton at 15.1 blocks E
  2. minecraft_pillar_up(height=6) — only got 2 blocks (partial, placement failed)
  3. mc_flee(distance=50) — fled 14.5 blocks (insufficient)
  4. mc_flee(distance=50) — fled 11.2 blocks
  5. mc_flee(distance=50) — "Claude1 fell from a high place" — DEATH
- **Fix Applied**: Set `bot.pathfinder.movements.maxDropDown = 0` during flee to prevent any cliff drops. Restore to previous value after flee completes. This means flee may not move as far in terrain with drops, but the bot survives.
- **Status**: Fixed in `src/bot-manager/bot-movement.ts`

---

## [2026-03-20] Bug: Death by Zombie during sheep combat - Session 16

- **Cause**: Called `mc_combat(target="sheep")` at night while a zombie was nearby. The combat tool targeted the sheep but the zombie attacked the bot fatally. The mc_combat tool does not check for nearby hostile mobs before engaging passive targets.
- **Location**: `src/tools/core-tools.ts` mc_combat - no hostile mob check when targeting passive mobs at night
- **Coordinates**: Died near (-17, 114, -95), respawned at (7.5, 120, 8.6) base
- **Last Actions**:
  1. mc_status — HP=20, Hunger=20, night time (ticks=13433)
  2. mc_combat(target="sheep") — zombie attacked bot while targeting sheep
  3. Death: "Claude1 was doomed to fall by Zombie"
- **Fix Applied**: Behavioral: avoid mc_combat on passive targets at night. Code fix needed: mc_combat should warn or refuse to target passive mobs when hostile mobs are nearby.
- **Status**: Behavioral fix applied (avoid night combat on passives). Code fix pending.

---

## [2026-03-20] Bug: Fall death - "Claude1 hit the ground too hard"

- **Cause**: Bot fell from a high place during previous session. Likely cliff traversal or pathfinder chose a path over a ravine/edge.
- **Location**: Unknown - occurred in previous session
- **Coordinates**: Respawned at (4.5, 90, -4.5) birch_forest
- **Last Actions**: Unknown from previous session
- **Fix Applied**: Monitoring. Existing mc_tunnel tool and fall detection exist. Still investigating root cause.
- **Status**: Investigating

---

## [2026-03-20] Bug: Fall death during food emergency - Session 15

- **Cause**: During food emergency (HP=4, hunger=0), bot was navigating toward sheep at (-64, 112, -128). mc_navigate failed with "Path blocked" multiple times. Bot attempted intermediate waypoint navigation and fell from elevation ~114 to lower ground.
- **Location**: `src/tools/core-tools.ts` mc_navigate - pathfinder accepts unsafe high-elevation moves when blocked
- **Coordinates**: Died near (-17, 114, -95), respawned at spawn point
- **Last Actions**:
  1. mc_navigate to sheep at 155 blocks - path blocked
  2. mc_navigate to intermediate (-30, 81, -50) - path blocked, "5 blocks lower"
  3. mc_navigate to (-40, 112, -110) - path blocked, fell from high place
- **Fix Applied**: None yet. Root cause: when pathfinder reports "path blocked", bot still moves partial distance and can end up at cliff edges.
- **Notes**: keepInventory=true so no items lost. HP/hunger restored to 20/20 on respawn. This death was caused by unsafe navigation during an emergency, not combat.
- **Status**: Investigating - need to prevent pathfinder from dropping bot off cliffs when navigating to blocked targets

---

## [2026-03-20] Bug: mc_navigate x/y/z coordinates cause "x.toFixed is not a function"

- **Cause**: MCP client passes coordinate parameters as strings (JSON number type not always preserved). `moveTo()` receives string instead of number, fails on `.toFixed()` call.
- **Location**: `src/tools/core-tools.ts` mc_navigate function, coordinate navigation branch
- **Coordinates**: (4.5, 90, -4.5)
- **Last Actions**: Called `mc_navigate(x=12, y=89, z=4)` to navigate to wheat block
- **Fix Applied**: Added `Number()` coercion + NaN validation for x/y/z before passing to moveTo. Updated all references in the segmented navigation loop to use coerced nx/ny/nz values.
- **Status**: Fixed (commit pending)

---

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

---

## [2026-03-22] Bug: Claude1 溺死 - bot.moveTo(0,70,0)がy=117の水中に誘導 (Session現在)

- **Cause**: `bot.moveTo(0, 70, 0)` を呼んだところ、pathfinderがy=117の水中エリアに誘導し溺死(drowned)。hunger=0でHP=9.2の状態から食料確保のために移動しようとしたが、指定Y=70を無視してy=117に移動した。
- **Location**: `src/bot-manager/bot-movement.ts` — moveTo関数のY座標指定が無視される可能性
- **Coordinates**: 開始(6, 78, 8) → 死亡(0, 117, 0)付近 → リスポーン(-6, 117, 4)
- **Last Actions**:
  1. HP=9.2, Hunger=0, 夜明け, 防具なし
  2. 食料確保のため `bot.moveTo(0, 70, 0)` を呼んだ
  3. y=117の水中エリアへ誘導されて溺死
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡確認。keepInventoryでアイテム保持。moveTo のY指定が無視されるバグ要調査。教訓: hunger=0/HP低い状態でmoveToを使わない。bot.navigate("animal")で動物を探す方が安全。
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

## [2026-03-18] Bug: mc_drop items re-collected by subsequent collectNearbyItems calls

- **Cause**: `mc_drop` moves bot only 4 blocks away after dropping. But `collectNearbyItems` has a default `searchRadius=10`. Any subsequent `mc_gather`, `mc_combat`, or `mc_craft` call that runs `collectNearbyItems` will re-pick up the dropped items.
- **Location**: `src/tools/core-tools.ts` lines 743-766 (mc_drop move-away logic)
- **Coordinates**: ~(3, 44, 3) — dirt was dropped, bot moved 4 blocks, then gather/gather re-picked all dirt
- **Last Actions**:
  1. mc_drop(dirt) — dropped 308x dirt, moved 4 blocks away
  2. mc_drop(diorite) — dropped 23x diorite; but next status showed dirt back in inventory
  3. mc_gather(iron_ore) — navigated back near drop area, collectNearbyItems re-collected dirt
- **Root Cause**: 4 block move-away < 10 block collectNearbyItems search radius
- **Fix Applied**: Increased move-away distance from 4 to 15 blocks in mc_drop (beyond 10-block collection radius). Also added a 1.5s wait after move to ensure item entities settle before returning.
- **Status**: Fixed

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

---

## [2026-03-22] Bug: bot.craft() and bot.gather() return "Cannot read properties of undefined" error

- **Cause**: `bot.craft(item, count, autoGather)` and `bot.gather(block, count)` called via mc_execute fail with "Cannot read properties of undefined (reading 'minecraft_craft_chain')" and "Cannot read properties of undefined (reading 'minecraft_gather_resources')". These functions depend on MCP tool calls internally. The mc_execute bot.craft() wrapper appears to reference an undefined object when called in this session.
- **Location**: `src/tools/core-tools.ts` — bot.craft() and bot.gather() wrappers
- **Coordinates**: (16.4, 102, 7.6) birch_forest
- **Last Actions**:
  1. Connected as Claude1, HP=20 Hunger=20
  2. Attempted `bot.craft('white_bed', 1, false)` → error
  3. Attempted `bot.craft('bed', 1, false)` → error
  4. Attempted `bot.craft('white_bed', 1, true)` → error
  5. Attempted `bot.gather('birch_log', 8)` → error
- **Fix Applied**: None (コード修正禁止)
- **Status**: Investigating. Using mc_execute with low-level bot API as workaround.

---

## [2026-03-18] Death: Slain by Skeleton during mc_gather iron_ore at night

- **Cause**: mc_gather(iron_ore, max_distance=64) navigated bot to surface at night with no armor. Skeleton shot and killed bot.
- **Location**: Surface birch_forest ~(-7, 94, 1)
- **Coordinates**: ~(-7, 94, 1) overworld, midnight
- **Last Actions**:
  1. Night (midnight), no armor equipped
  2. mc_gather(iron_ore, count=4, max_distance=64) navigated bot to open surface
  3. Skeleton shot bot — "Claude1 was shot by Skeleton"
- **Item Loss**: cooked_beef x8 lost (9 → 1), iron_ingot x2 retained (keepInventory=true)
- **Root Cause**: mc_gather does not check for hostile mobs or night conditions before navigating. Bot was exposed on surface at midnight without armor.
- **Fix Needed**: mc_gather should check threats before moving to target block, or avoid surface navigation at night when HP < 15 and no armor
- **Status**: Recorded. Continuing gameplay.

---

## [2026-03-19] Deaths: Fall + Zombie (Session current reconnect)

- **Cause**: Bot died twice before this session reconnect. Chat log: "Claude1 fell from a high place" then "Claude1 was slain by Zombie". Likely from cave navigation at low HP/hunger before reconnect.
- **Location**: OW near (58, 80, -4) / cave area
- **Last Actions**: Cave escape sequence from Y=61 to Y=80, hunger=0, HP=9.2 before reconnect
- **Outcome**: Respawned HP=20, Hunger=20 (keepInventory=true). Now at (−2, 100, 6) birch_forest
- **Status**: Recorded. Continuing gameplay.

---

## [2026-03-19] Death: Slain by Zombie while exploring for food (HP=17→0)

- **Cause**: Bot was exploring far from base searching for animals (no food in inventory). Navigating at night/evening, zombie killed bot. HP was 17 at start of exploration but midnight arrived during travel.
- **Location**: OW ~(45, 96, -71) old_growth_birch_forest
- **Coordinates**: ~(45, 96, -71)
- **Last Actions**:
  1. Started at (-9, 109, 11) with HP=17, hunger=11, no food
  2. Searched sheep/cow/pig/chicken within 64 blocks at 3 locations — all empty
  3. Navigated to (-69, 101, 60) then to (45, 98, -69) — no animals found
  4. Midnight arrived, zombie killed bot: "Claude1 was slain by Zombie"
- **Root Cause**: No animals anywhere in 128+ block radius (depopulated area). Long exploration at night with no armor. Iron sword equipped but zombie still lethal.
- **Fix Needed**: Abort exploration if approaching night (ticks > 11500) and no shelter/bed available
- **Status**: Recorded. Bot respawned HP=16.3, built emergency shelter. Continuing.

---

## [2026-03-20] Death: Fall from high place (HP=1, starvation + mc_drop displacement)

- **Cause**: Bot was at HP=1, Hunger=0 from chronic starvation. mc_drop moved bot 15 blocks away from dropped items, which displaced bot into a deep ravine area. Bot fell from high place and died.
- **Location**: OW near ravine at approximately (9-17, 85-97, 3-7)
- **Coordinates**: Near ravine between farm plots and base
- **Last Actions**:
  1. Multiple sessions of mc_drop cobblestone → re-pickup loop (cobblestone dropped, bot moved 15 blocks, but next mc_drop moved back toward previous drop zone)
  2. HP dropped from 10→7→5→1 over several sessions due to starvation (hunger=0 continuously)
  3. mc_farm successfully grew some wheat but never enough for bread (need 3, kept getting 1-2)
  4. iron_sword + bucket crafted successfully in final session
  5. Chat showed: "Claude1 fell from a high place" — fatal fall with HP=1
- **Root Causes**:
  1. **Chronic food crisis**: No animals within 128+ blocks, mc_farm only yields 1 wheat per call (need 3 for bread)
  2. **mc_drop displacement**: 15-block move-away sends bot to dangerous terrain (ravine edge)
  3. **HP=1 makes any damage fatal**: Even 1-block fall = death
- **Outcome**: Respawned with keepInventory=true. iron_sword + bucket retained.
- **Fix Needed**:
  1. mc_farm should try harder to find/place multiple farmland plots in one call
  2. mc_drop should check terrain safety before moving (avoid ravine edges)
  3. When HP <= 3, bot should stay completely still and only do inventory/craft actions
- **Status**: Recorded. Continuing with keepInventory respawn.

## [2026-03-20] Death: Fall from high place (2nd time) — ravine/cliff area near new base
- **Cause**: Bot fell from high place in cliff/ravine area near new base at (~63, 84, -114)
- **Coordinates**: Near (63, 84, -114) — large exposed stone ravine/cliff area
- **Last Actions**:
  1. Previous agent crafted 2 chests + crafting_table, placed at (63-65, 84, -114)
  2. Bot was operating in exposed cliff/ravine terrain with large drops
  3. Hunger was at 1 (critical) — likely starvation damage + fall
  4. Chat showed: "Claude1 hit the ground too hard"
- **Root Causes**:
  1. **Dangerous terrain**: Bot operating in cliff/ravine area with large elevation changes
  2. **No pathfinding safety**: mc_navigate doesn't avoid cliff edges
  3. **Hunger 1**: Starvation damage may have reduced HP before fall
  4. **Recurring pattern**: Same death type as previous (fall from high place)
- **Outcome**: Respawned with keepInventory=true. Items retained.
- **Fix Needed**:
  1. Bot should avoid operating near cliff edges — stay on flat terrain
  2. mc_navigate needs terrain safety check (avoid paths near drops >3 blocks)
  3. Food crisis must be resolved before any exploration/movement
  4. Consider adding fall damage prevention (water bucket MLG or avoid high areas)
- **Status**: Recorded. 2nd fall death — this is a systemic issue with terrain safety.

## [2026-03-20] Death: Slain by Zombie (3rd death) — night combat at HP=3.5
- **Cause**: Bot was slain by Zombie at night. HP had dropped to 3.5 from fall damage/starvation before engaging.
- **Coordinates**: Near (68, 80, 8) — ravine area
- **Last Actions**:
  1. Agent connected, found HP=11, midnight, multiple hostiles
  2. Tried to navigate to chest (64, 84, -114) — 50 blocks away
  3. Safety system blocked: "Cannot move 50.6 blocks with critical HP(3.5/20)"
  4. HP dropped from 11→3.5 during navigation attempt
  5. Tried mc_combat(target="zombie") — "No zombie found nearby"
  6. Killed by zombie while searching
- **Root Causes**:
  1. **Night + low HP**: Bot was at HP=11 at midnight with multiple hostiles
  2. **Failed to shelter**: Should have built shelter instead of navigating 50 blocks
  3. **HP dropped during movement**: Navigation through hostile terrain drained HP
  4. **No food**: Cannot recover HP without food
- **Outcome**: Respawned with keepInventory=true. HP=20, Hunger=20. Near chest at (12, 92, 6).
- **Fix Needed**:
  1. When HP<10 at night, do NOT navigate — build immediate shelter (mc_build)
  2. Food crisis is the root cause of all deaths — must be resolved first
  3. Agent should check time of day and act accordingly (night=shelter, day=farm)
- **Status**: Recorded. 3rd death. Pattern: low HP + no food + dangerous activity = death.

## [2026-03-20] Death: Drowned (4th death) — water source during mc_farm
- **Cause**: Bot drowned while farming near water source. HP was 0.67 before recovery, then recovered to 16 via bread, but drowned during mc_farm water navigation.
- **Coordinates**: Near water at (8-12, 96-101, 9-31) — farm area
- **Last Actions**:
  1. HP started at 1.7, Hunger 0 — critical
  2. mc_farm x4, crafted and ate 3 breads
  3. HP recovered from 0.67 to 16, Hunger to 17
  4. During final mc_farm, bot moved near water for irrigation
  5. "Claude1 drowned" — bot got stuck underwater
- **Root Causes**:
  1. **mc_farm moves bot into water**: Farm tool navigates near water sources for irrigation, sometimes INTO water
  2. **Low HP + water**: At HP<2, even brief submersion can be fatal
  3. **No breath management**: Bot doesn't surface when underwater
- **Fix Needed**:
  1. mc_farm should navigate NEAR water, not INTO water
  2. Add drowning prevention: check if bot head is underwater, surface immediately
  3. When HP<5, avoid water-adjacent activities
- **Fix Applied**: commit abf2a0e — mc_farm now finds a solid land block adjacent to water and navigates there instead of into the water block itself. Both 64-block and 200-block water search paths fixed.
- **Status**: Fixed (code). 4th death. Drowning during farming.

---

## [2026-03-22] Death: Slain by Zombie — mc_craft timeout中に拠点から遠ざかりHP低下

- **Cause**: mc_craft(chest x2, autoGather=true)が180秒タイムアウト。その間にボットが拠点(-31,68,-12)まで移動し、hunger=7、HP=3まで低下。zombie接近時にmc_flee/mc_combatが使用不可（HP3のため拒否）。death確認。
- **Location**: OW (-31, 68, -12) old_growth_birch_forest
- **Coordinates**: (-31, 68, -12)
- **Last Actions**:
  1. mc_craft(chest, count=2, autoGather=true) 実行
  2. 180秒タイムアウト — その間にボットが遠くへ移動
  3. 復帰時 HP=3, hunger=7, zombie 1.6m以内
  4. mc_combat(chicken): "[REFUSED] Cannot hunt — hostile in range"
  5. mc_combat(zombie): "[REFUSED] HP too low (3.0/20)"
  6. mc_flee: "Not connected" エラー
  7. 再接続後 mc_flee → "Fled 0.8 blocks" → hp=20 (keepInventory respawn)
- **Root Cause**: mc_craft(autoGather=true)がタイムアウトする間にボットが安全でない場所へ移動し、食料なし状態でzombieに倒された。autoGatherのタイムアウト中の安全管理が不十分。
- **Outcome**: Respawned HP=20, Hunger=20 (keepInventory=true). 拠点 (1,103,8) に戻った。
- **Status**: 記録済み。継続。

## [2026-03-20] Death: Killed by Witch using magic (5th death)
- **Cause**: Witch attacked bot with magic potions. Bot had HP=10, fled successfully (11.4 blocks away), but witch continued ranged attack during mc_navigate. Bot died while navigating to chest at (9,96,4) from position (20,108,-15).
- **Coordinates**: Near (20, 108, -15)
- **Last Actions**:
  1. mc_status showed HP=10, witch + creeper nearby
  2. mc_flee — fled 11.4 blocks from witch
  3. mc_status — still HP=10, witch + creeper in area
  4. mc_navigate to chest — killed by witch during navigation
- **Root Causes**:
  1. **mc_flee insufficient distance**: 11.4 blocks is within witch's 16-block attack range
  2. **No food in inventory**: Could not heal before navigating
  3. **HP=10 too low for any activity near hostile mobs**: Should have fled further
- **Fix Needed**:
  1. mc_flee should flee at least 20 blocks from witches (they have 16-block range)
  2. Agent should not navigate while hostile mobs are in range with HP<=10
- **Status**: Recorded. 5th death.

---

## [2026-03-20] Death: Starvation + fall damage in ravine (6th death)
- **Cause**: Bot fell repeatedly in ravine despite maxDropDown=2 fix. Hunger=0, no food, HP dropped from 14.3→2.3 due to combined fall damage + starvation. Fatal starvation at Y=58.
- **Coordinates**: (-11.5, 58, 6.5)
- **Last Actions**:
  1. mc_navigate(target_block="crafting_table") at Y=72 — fell to Y=63
  2. mc_navigate(target_block="crafting_table") — fell further to Y=58
  3. Hunger=0, HP=2.3, no food — starvation death
- **Root Causes**:
  1. **bot-blocks.ts maxDropDown=10 was fixed to 2, but moveTo pathfinder still causes falls**: The pathfinder plans routes near ravine edges where Minecraft physics push bot off ledges. maxDropDown only controls planned drops, not physics-induced falls near edges.
  2. **No food obtained in multiple sessions**: Bot trapped in ravine, unable to reach surface farm area
  3. **Ravine is a death trap**: Y=72→Y=58 in two navigation attempts despite safety fixes
- **Fix Needed**:
  1. Add staircase-mining escape tool: dig 1-block-wide staircase upward (safe, guaranteed)
  2. mc_navigate should refuse to pathfind in ravines (detect large Y gaps in terrain nearby)
  3. Food priority: never enter dangerous terrain without food
- **Status**: Investigating. 6th death.

---

## [2026-03-20] Death: Killed by Zombie during chest operations (7th death)
- **Cause**: Bot was stationary during mc_store deposit_all_except at chest (5,101,25). Zombie approached and killed bot while it was repeatedly failing to deposit items.
- **Coordinates**: Near (5, 101, 25)
- **Last Actions**:
  1. Navigated to chest at (5,101,25)
  2. mc_store deposit_all_except — all deposits failed with various errors
  3. Bot was stationary for extended time, zombie killed it
- **Root Causes**:
  1. **mc_store deposit errors**: Multiple deposit failures ("inventory unchanged after 3s wait", "GoalChanged", "Chest open timeout") kept bot stationary
  2. **No hostile mob awareness during chest operations**: Bot doesn't check for threats while performing storage
  3. **Midnight = zombie spawns**: Dangerous to do extended stationary operations at night
- **Items Lost**: stone_hoe, obsidian x4, dirt x29, torch x64, white_wool x1, cobblestone x~200 (dropped at death location, keepInventory partial?)
- **Fix Needed**:
  1. mc_store should check for hostile mobs before/during operations
  2. Bot should not perform extended stationary operations at night without shelter
- **Status**: Recorded. 7th death.
- **Status**: Recorded. 5th death. Witch ranged attack during navigation.

---

## [2026-03-20] Deaths: fall x2 + witch x2 + zombie x1 (8th-12th deaths)

- **Cause**: Multiple deaths in session gap before this reconnect:
  1. "Claude1 fell from a high place" (x2) — ravine fall deaths, maxDropDown=2 fix insufficient
  2. "Claude1 was killed by Witch using magic" (x2) — witch ranged potions, flee didn't persist
  3. "Claude1 was slain by Zombie" — zombie melee at low HP
- **Location**: `src/bot-manager/bot-survival.ts` — AutoFlee threshold and distance
- **Coordinates**: Unknown (died before this session reconnect)
- **Last Actions**: Previous session navigating in ravine area near Y=84
- **Fix Needed**:
  1. Fall deaths: ravine navigation needs stronger avoidance
  2. Witch deaths: flee distance must exceed witch's 16-block attack range (flee >= 25 blocks)
  3. Zombie death: flee should trigger at HP <= 12 not HP <= 10 for safer margin
- **Status**: Recorded. 8th-12th deaths.

---

## [2026-03-20] Death: Fall during mc_gather short_grass (13th death)
- **Cause**: Bot fell from height while gathering short_grass. mc_gather navigated to grass near cliff/ravine edge, bot was pushed off by physics.
- **Death message**: "Claude hit the ground too hard"
- **Coordinates**: Somewhere between (14, 62, 43) and (-70, 118, -11) (respawn)
- **Last Actions**:
  1. mc_flee from creeper (success)
  2. mc_gather(block="short_grass", count=10) — fell during navigation to grass
- **Root Causes**:
  1. **mc_gather uses pathfinder which routes near cliff edges**: Same root cause as deaths #6, #8-12
  2. **Hunger=0 meant no HP regen**: Any fall damage is permanent
  3. **physicsTick fall detection didn't prevent death**: Fall was likely instant/fatal
- **Fix Needed**:
  1. mc_gather should inherit maxDropDown=2 safety settings
  2. Consider refusing navigation when Hunger=0 and HP<6
- **Status**: Recorded. 13th death.

---

## [2026-03-20] Death: Starvation (Hunger=0, HP=1 → death) (14th death)

- **Cause**: Bot in birch_forest with no food in inventory. Hunger=0, HP dropped to 1 due to starvation damage. No nearby animals (pig/cow/sheep/chicken). sweet_berry_bush not found within 50 blocks. Safety guard in mc_navigate blocked navigation at critical HP. Zombie killed bot at HP=1.
- **Death Message**: "Claude1 was slain by Zombie"
- **Coordinates**: ~(18, 75, -35) birch_forest
- **Last Actions**:
  1. HP=10, Hunger=0 — no food, no animals nearby
  2. mc_combat(target="sheep") — no sheep found nearby
  3. mc_navigate(target_entity="sheep", max_distance=200) — 133 blocks away, unreachable
  4. mc_navigate(target_entity="pig", max_distance=200) — path blocked
  5. mc_navigate(target_entity="chicken", max_distance=200) — blocked by critical HP safety guard
  6. mc_gather(block="sweet_berry_bush") — 0 found within 50 blocks
  7. HP=1 from starvation damage, Zombie killed
- **Root Cause**: No persistent food farm established. Bot relies on hunting but animals are sparse/unreachable.
- **Fix Needed**: Need wheat farm or animal pen before Phase 5 diamond mining to prevent starvation during extended mining sessions.
- **Status**: Recorded. 14th death. Starvation.

---

## [2026-03-22] Death: Claude1 slain by Zombie — Hunger=1 + night nav + no food (Session current)

- **Cause**: Hunger=1でHP回復不能。夜間にZombieが密集した状態でmc_navigateが経路ブロックされ逃げ場なし。食料が完全にない状態で夜間行動を継続したため死亡。
- **Death Message**: "Claude1 was slain by Zombie"
- **Coordinates**: (~2, 103, 21) birch_forest
- **Last Actions**:
  1. mc_flee() x2 — Creeper/Skeletonから逃脱
  2. mc_combat(target="cow") — [REFUSED] Creeper 6.5m
  3. mc_navigate(target_entity="cow/sheep/pig") — 64m以内に動物なし
  4. mc_store list チェスト — reach不可(Y差2)
  5. mc_navigate to crafting_table (-3,104,20) — path blocked
  6. mc_navigate to furnace (-8,90,-6) — [REFUSED] HP低すぎ
  7. Zombie 11m接近 → 死亡
- **Root Cause**: 食料がない状態での夜間活動。Hunger=1でHP自然回復不能。mc_navigateが経路ブロックで到達できず逃げ場失失。
- **Fix Needed**: 食料ゼロで夜間になった場合、即座にシェルター待機(穴掘り)に切り替える判断が必要。
- **Status**: Recorded.

---

## [2026-03-22] Death: mc_flee落下死 — HP0.5でクリーパー逃避中に転落 (Session current)

- **Cause**: HP=0.5、Hunger=8でクリーパー(19m北)から逃げるためmc_flee(30)実行。逃避中に高所から転落死。
- **Death Message**: "Claude1 fell from a high place"
- **Coordinates**: (-3, 84, -2) birch_forest
- **Last Actions**:
  1. 接続時HP=0.5、Hunger=4、食料なし
  2. パンをcraftして食べHunger=8に回復
  3. クリーパー19m北を確認
  4. mc_flee(30) 実行 → 転落死
- **Root Cause**: HP=0.5という極限状態でmc_fleeを実行。mc_fleeは安全なルートを考慮せず逃げるため崖から転落。1ブロック落下でも致死的なHP量だった。
- **Fix Needed**: HP<1の場合はmc_fleeを使用せず、穴掘りシェルター(dig down 3 blocks)またはその場でスニーク(shiftキー)を選択すべき。
- **Status**: Recorded.

---

## [2026-03-22] Bug: Claude1 溺死 - bot.moveTo(12,92,6)がy=120の位置に移動後に溺死 (Session current)

- **Cause**: `bot.navigate({type:'coordinates', x:12, y:92, z:6})` を呼んだところ、bot がy=120の水中付近に誘導された。その後チャットに「Claude1 drowned」メッセージが届いた。高所チェストへの経路探索が水中経由の経路を選択している模様。
- **Location**: (9, 120, -6) - 移動先。死亡詳細座標不明
- **Coordinates**: Start (4.3, 81, 9.7) → Arrived (9, 120, -6) → Drowned
- **Last Actions**: 1x2穴でdawn待機 → moveTo(12, 92, 6)チェスト確認へ → y=120に到達後溺死
- **Fix Applied**: None (コード修正禁止)
- **Status**: 死亡。keepInventoryによりアイテム保持。moveTo/navigateが水中経路選択するバグは既存既知バグと同種。

---

## [2026-03-22] Bug: bot.gather/combat/farm/build が瞬時終了して何もしない (Session current)

- **Cause**: mc_execute内でbot.gather(), bot.combat(), bot.farm(), bot.build()を呼び出すと、エラーなく瞬時に完了するが実際には何もしない。インベントリ変化なし、位置変化なし。
- **Symptoms**:
  - `bot.gather("birch_log", 16)` → 瞬時完了、birch_log 2個のまま変化なし
  - `bot.combat("cow", 15)` → 瞬時完了、食料ドロップなし、HP変化なし
  - `bot.farm()` → 瞬時完了、インベントリ変化なし
  - `bot.build("shelter")` → 瞬時完了、構造物建設されず
  - `bot.build("farm")` → 瞬時完了、農場建設されず
- **Working**: bot.navigate(), bot.craft(), bot.status(), bot.inventory(), bot.chat(), bot.getMessages() は正常動作
- **Location**: `src/tools/core-tools.ts` またはbot実装
- **Coordinates**: (179, 62, -9) birch_forest
- **Last Actions**: 複数のgather/combat/build試行、全て瞬時完了で効果なし
- **Fix Applied**: None (コード修正禁止)
- **Status**: Investigating. HP=1.8, Hunger=0で生存中（飢餓ダメージも来ていない）

---

## [2026-03-23] Bug: Claude1 slain by Zombie during moveTo navigation - Session current

- **Cause**: bot.moveTo(-17, 94, -22) 実行中にゾンビに殺された。移動中の戦闘回避機能が不十分。
- **Location**: src/tools/core-tools.ts (moveTo/navigation)
- **Coordinates**: 死亡時不明（navigation中）, spawn: (-5, 87, 3)
- **Last Actions**:
  1. bot.combat("cow") x2 → 成功報告されるが食料ドロップなし
  2. bot.moveTo(-17, 94, -22) (かまどへ) → 移動中にゾンビに殺された
- **Fix Applied**: None
- **Status**: Open

## [2026-03-23] Bug: Claude1 fell from a high place during moveTo - Session current

- **Cause**: bot.moveTo(1, 88, -3) 実行中に高い場所から落下死。pathfinderが崖を通るルートを選択。
- **Location**: src/tools/core-tools.ts (moveTo/pathfinder)
- **Coordinates**: 落下前 (-6, 85, -1), Y=85から落下
- **Last Actions**:
  1. 作業台(1, 88, -3)にmoveTo
  2. 途中の座標(-6, 85, -1)まで到達後に落下
- **Fix Applied**: None
- **Status**: Open. pathfinderが安全でないルートを選択する根本的な問題。


## [2026-03-24] Bug: Claude1 slain by Zombie during food search - Session current

- **Cause**: bot.combat("zombie")でクリーパー接近中断→逃走→別のゾンビに接触して死亡。食料探索中に複数のhostileに囲まれた。
- **Location**: src/tools/core-tools.ts (combat/flee)
- **Coordinates**: 死亡位置不明（(24, 72, -35)付近→農場方面に移動中）, リスポーン: (4, 94, 6)
- **Last Actions**:
  1. 夜間待機 → 夜明け後に食料探索開始
  2. bot.flee() → bot.combat("zombie") → CREEPER ABORT
  3. navigate({x:2, y:72, z:5}) → 移動中にゾンビに殺された
- **Fix Applied**: None
- **Status**: Open. keepInventoryで持ち物保持。HP/Hunger全快でリスポーン。


## [2026-03-24] Bug: Claude1 trapped underground by pathfinder navigation - Critical

- **Cause**: bot.navigate()が地下洞窟(Y=55)へのルートを選択し、地上に戻れなくなった。navigate()は「Path blocked」を返し続け、flee()も「Terrain blocking escape routes」で失敗。飢餓ダメージで死亡。
- **Root Pattern**: navigateのpathfinderが地表(Y=86)への上昇ルートを見つけられない。洞窟に入ると完全にトラップされる。
- **Location**: src/bot-manager/ (pathfinder configuration)
- **Coordinates**: トラップ地点 (-8, 55, 6), リスポーン先: 拠点付近
- **Last Actions**:
  1. navigate({x:2, y:72, z:5}) → 地下洞窟へ誘導
  2. navigate系コマンドを20回以上試みるも全て「Path blocked」
  3. pillarUp失敗（ceiling blockingか、scaffoldブロック配置失敗）
  4. flee()失敗（terrain blocking, 1m以下しか移動できず）
  5. combat全て拒否（cliff edge or creeper nearby）
  6. gather("stone"), gather("dirt") → timeout（gather関数が地下では動作しない可能性）
  7. 空腹度0で飢餓死
- **Fix Needed**: 
  - navigateがY座標の低い目標を選ぶ際に地下洞窟を避けるようにすること
  - または地下に入ったときの脱出ルーティン（掘り上がる）を追加
- **Status**: Critical recurring bug. keepInventoryで持物保持。



## [2026-03-24] Bug: Claude1 drowned during cave escape attempt

- **Cause**: pillarUp→water surface (Y=56 lake/river)→溺死。洞窟脱出中に水域に出てしまい溺れた。
- **Location**: src/bot-manager/bot-movement.js (pillarUp/navigation near water)
- **Coordinates**: 溺死地点 (~0, 56, 3) 水域, リスポーン: (2.4, 82, 6.5) 拠点
- **Context**: Y=55地下洞窟からpillarUpで脱出中（石ピッケルなし→gather失敗→pillarUp繰り返し）
- **Last Actions**:
  1. pillarUp (Y=56→59→62→64→66→68→71) 複数回呼び出し
  2. moveTo(3,80,6) → 途中で水に落ちてY=68.1に
  3. pillarUp → "swam up to Y=56.0 surface" (水面)
  4. 移動中に溺死
- **Fix Needed**: pillarUpが水域に出た場合の処理。水中での移動安全チェック。
- **Status**: keepInventoryで持物保持。死亡後HP/Hunger全快。stone_pickaxeクラフト済み。

## 2026-03-24 Session - Skeleton Death
- **死因**: Skeleton に矢で撃たれて死亡（"Claude1 was shot by Skeleton"）
- **状況**: 真夜中、HP=14で逃走中、Y=72付近（地下？）
- **近くの敵**: pillager x2 (11-13m north), skeleton x4, creeper x5, zombie x4, witch x1
- **防具**: なし（0/4スロット）
- **反省**: 夜間にnavigateを使ったことで敵エリアに誘導された可能性
- **対策**: 夜間はpillarUpのみ。navigateは昼間のみ使用すること

## [2026-03-25] Bug: Complete movement freeze at cliff edge - Session 57

- **Cause**: ボットが崖端(29.7, 91, -6.5)に位置し、東西北がstoneブロック、南がY=90空洞の崖。pathfinderが全方向で落下リスクと判定し経路なし→全movement API失敗。
- **Root Pattern**: 高地(Y=91)の崖端でpathfinderが完全にブロック。pillarUp/flee/moveTo/navigate全てタイムアウト。
- **Location**: src/bot-manager/bot-movement.ts (pathfinder cliff detection)
- **Coordinates**: スタック地点 (29.7, 91, -6.5) birch_forest biome
- **Working APIs**: status(), inventory(), place(), chat(), wait()
- **Failed APIs**: moveTo(), navigate(), gather(), craft(), smelt(), build(), pillarUp(), flee()
- **Last Actions**:
  1. 高地(Y=91)の崖端に移動
  2. 東西北: stoneブロック、南: 崖(Y=90が空洞)
  3. pathfinder経路なし→全movement失敗
  4. place()で南側に土ブロック足場作成を試みたが解決せず
- **Fix Needed**: 崖端スタック時の脱出ルーティン。pillarUpが確実に動作するよう崖端判定を修正。
- **Status**: Phase 1-3完了(stone_sword, stone_pickaxe所持)。Phase 4完全停止中。
