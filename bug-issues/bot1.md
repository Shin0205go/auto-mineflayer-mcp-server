# Bot1 - Bug & Issue Report

このファイルはBot1専用です。発見したバグやイシューをここに記録してください。

## 報告形式

### [日付] バグタイトル
- **症状**: 何が起きたか
- **原因**: 推定される原因
- **修正**: どう修正したか（または修正予定）
- **ファイル**: 関連するファイルパス

---

## Session 38 Status Update (2026-02-17)

### Current Situation Assessment

**Online Bots**: Claude1 (leader), Claude3, Claude5, Claude7
**Offline/Unknown**: Claude2, Claude4, Claude6

**Phase Status**: Phase 6 continuing
- Goal: ender_pearl x12, blaze_rod x7
- Progress: UNKNOWN - all pearls lost in chest disappearance
- Blaze rods: Unknown (Claude6 had 1 last session, now offline)

**Resource Crisis**:
- ✅ Main chest (2,106,-1): MISSING - vanished again (3rd incident)
- ✅ Second chest (-6,101,-14): MISSING - vanished again
- ✅ Backup chest (10,87,5): Only cobblestone x64
- ⚠️ All 9-11 ender pearls from previous session LOST
- ⚠️ Food crisis: No food in any chest

**Team Status**:
- Claude1: (9,85,2), HP 20/20, hunger 18/20, at base monitoring
- Claude3: (6,80,7), HP 17/20, hunger 17/20 ⚠️, trying to plant wheat, has bone_meal x2
- Claude5: (unknown), exploring for enderman, has diamond_sword
- Claude7: (7.5,109,-4.5), HP 20/20, hunger 20/20, at portal site, has diamond x3, obsidian x2

**Issues Identified**:
1. 🚨 **CRITICAL: Ender pearls not dropping from endermen** - Claude5 and Claude7 both report endermen die but no pearls drop. gamerules confirmed ON (doMobLoot=true). Either server-side issue or item entity detection bug. Phase 6 BLOCKED.
2. 🚨 **CRITICAL: Wheat harvest gives seeds only, no wheat** - Claude3 reports bone_meal → harvest produces wheat_seeds but NO wheat items. Food crisis cannot be solved via farming.
3. 🚨 **Chest disappearance epidemic** - Both main chests vanished AGAIN (3rd time). All stored pearls lost.
4. ⚠️ **Stick crafting still broken** - Claude5 and Claude7 report persistent "missing ingredient" error. Blocks diamond tool crafting.
5. ⚠️ **Food crisis** - No food in storage, wheat farming broken, respawn strategy is only option

**Actions Taken**:
- Confirmed team status via chat
- Directed Claude7 to mine obsidian x8 more (needs water bucket + diamond pickaxe)
- Directed Claude5 to continue enderman hunting, store pearls in chest (10,87,5)
- Directed Claude3 to establish wheat farm using bone_meal for instant growth
- Investigating stick crafting bug

**Next Steps**:
1. Fix stick crafting bug (CRITICAL - blocks diamond tools)
2. Establish wheat farm for food
3. Replace lost chests and restart pearl collection
4. Continue obsidian mining for Nether portal

---

## [2026-02-17] 🚨 CRITICAL: Enderman Pearl Drops Not Working

### Symptom
- Multiple bots (Claude5, Claude7) report killing endermen but NO ender pearls drop
- Gamerules confirmed: doMobLoot=true, doEntityDrops=true (set by Claude2/Claude5)
- Attack code calls `collectNearbyItems()` with extended parameters for endermen:
  - `searchRadius: 16` (wider than default 10)
  - `waitRetries: 12` (longer wait for drops to appear)
  - Delay of 1000ms before collection starts
- Code looks correct in `bot-survival.ts` lines 410-416

### Investigation
- `bot-items.ts` collectNearbyItems() checks for `entity.name === "item"` at line 43
- This should detect all dropped items
- Possible causes:
  1. **Server-side drop disabled** - gamerules show true but server may override
  2. **Item entity not spawning** - server kills item entities immediately
  3. **Item entity detection timing** - drops spawn too slowly, even 1000ms + 12 retries not enough
  4. **Entity name mismatch** - "item" entity name may be different in this server version
  5. **Inventory sync bug** - items collected but not synced to bot inventory

### Testing Needed
- Ask Claude5 to report all nearby entities after killing enderman (using `getNearbyEntities`)
- Check if "item" entities appear at all after mob death
- Try killing other mobs (zombies, skeletons) to see if they drop items
- Check server console for item spawn events

### Impact
- **BLOCKS PHASE 6 COMPLETELY** - Cannot collect ender pearls = cannot craft ender eyes = cannot find stronghold
- Team must investigate server configuration or find workaround

### Temporary Workaround
- None available - Phase 6 cannot proceed without pearl drops
- May need server admin intervention or /give commands

---

## [2026-02-17] 🚨 CRITICAL: Wheat Harvest Only Gives Seeds

### Symptom
- Claude3 reports: farmland → plant seeds → bone_meal → harvest = wheat_seeds only, NO wheat
- Bone meal consumed (x2), wheat grows to full height, but harvest produces seeds instead of wheat items
- Food production completely broken

### Investigation
- Harvest code likely calls `bot.dig()` on wheat crops
- Wheat should drop wheat + seeds when fully grown (age=7)
- Possible causes:
  1. **Crop maturity detection wrong** - harvesting before age=7
  2. **Server drop rules** - crops drop only seeds
  3. **Item entity collection timing** - wheat drops but not collected
  4. **Inventory sync** - wheat collected but not visible

### Impact
- **Food crisis cannot be solved** - Farming is the primary food source
- Respawn strategy is only option for HP/hunger recovery
- Long-term survival impossible without food

### Temporary Workaround
- Use respawn strategy (keepInventory ON) for HP/hunger recovery
- No item loss, instant full HP/hunger restoration
- Not sustainable long-term but works for now

---

## [2026-02-17] Stick Crafting Bug - STILL PRESENT

### Symptom
- Claude5 reports stick crafting fails with "missing ingredient" error
- Has dark_oak_planks x4 but cannot craft sticks
- Prevents diamond_pickaxe crafting, blocking Nether portal construction
- Bug persists after git merge and rebuild

### Investigation Status
- Code review of `bot-crafting.ts` lines 359-493 shows:
  - ✅ Manual recipe creation for sticks exists (lines 433-462)
  - ✅ Always bypasses recipesAll() for stick/crafting_table (line 429)
  - ✅ Finds planks with highest count (line 436)
  - ✅ Creates manual recipe with 2 planks → 4 sticks
  - ✅ Fallback to recipesFor() if manual recipe fails (lines 844-861)
  - ✅ Window-based crafting as final fallback (lines 864-1058)

### Possible Causes
1. **Mineflayer recipesFor() broken** - Even fallback fails with specific plank metadata
2. **Bot inventory sync issue** - Planks not properly synchronized after /give or drops
3. **mcData version mismatch** - Plank item IDs changed between Minecraft versions
4. **Recipe delta calculation** - manual recipe delta might be incorrect

### Need More Info
- Exact error message from Claude5 (full stack trace)
- Which fallback layer is failing (manual recipe vs recipesFor vs window-based)
- Bot's current inventory state when error occurs
- Console.error output from craftItem() function

### Resolution
- PENDING - Need to reproduce error or get detailed logs from Claude5
- May need to add more diagnostic logging to craftItem()
- Consider forcing window-based crafting for sticks as temporary workaround

---

## Session 37 Status Update (2026-02-17)

### Current Situation Assessment

**Online Bots**: Claude1 (leader), Claude3, Claude4, Claude7
**Offline/Unknown**: Claude2, Claude5, Claude6

**Phase Status**: Phase 6 continuing
- Goal: ender_pearl x12, blaze_rod x7
- Progress from last session: 11/12 pearls, 1/7 blaze rods
- **CRITICAL**: Ender pearls missing - not in any chest, no bot reported having them

**Resource Status**:
- Chest at (10,87,5): only cobblestone x64
- Main chest (2,106,-1): MISSING (vanished)
- Second chest (-6,101,-14): MISSING (vanished)
- Food crisis: No food in chests, multiple bots low hunger

**Team Status**:
- Claude1: (10,87,4), HP 20/20, hunger 18/20, no food
- Claude3: (78.5,59,75.5), HP 20/20, hunger 5/20 ⚠️ CRITICAL, diamond_axe x1
- Claude4: (-5.7,101,-11.6), HP 20/20, hunger 20/20, diamond x2, obsidian x3, iron_pickaxe
- Claude7: HP 10/20 ⚠️, hunger critical, attempting respawn

**Issues Identified**:
1. Ender pearl inventory loss - 11 pearls from last session disappeared
2. Food crisis - no food in storage, multiple bots starving
3. Chest disappearance continues - both main chests missing
4. Time stuck at 15628 (night) - server issue

**Actions Taken**:
- Confirmed Phase 6 status to team
- Directed Claude4 to continue diamond mining (needs 3 more for enchanting table)
- Directed Claude7 to respawn and gather food (wheat)
- Directed Claude3 to gather food then hunt enderman
- Monitoring for bug reports and errors

**Next Steps**:
- Locate source of ender pearls (check if any offline bot has them)
- Establish food production (wheat harvest)
- Continue diamond mining for Phase 5 completion (enchanting table)
- Resume enderman hunting for Phase 6 (pearls)

---

## Session 36 Status Update (2026-02-17)

### 🚨 CRITICAL BUG: Repeated Chest Disappearance

**What Happened**:
- Claude1 placed chest at (2,105,1) - placement confirmed successful
- Moved away briefly (fell, respawned)
- Returned to check chest contents - chest completely gone (air block)
- This is the SECOND time a chest has vanished at base location
- First incident: (2,106,-1) - 10 pearls were inside but safe with Claude6
- Second incident: (2,105,1) - chest placed and vanished within ~1 minute, empty

**Pattern Analysis**:
- Both incidents at base coordinates near (2,~105-106,~0)
- Both chests vanished without explosion or visible cause
- No items found on ground after disappearance
- Time between placement and disappearance: <5 minutes

**Code Review**:
- `bot-blocks.ts` lines 154-169: Verification logic checks block after 500ms + 3x200ms retries
- Placement returns success only if block verified present
- Both times placement reported success, but block later disappeared

**Possible Causes**:
1. Server-side anti-cheat removing placed blocks?
2. Another bot accidentally breaking the chest?
3. World corruption at specific coordinates?
4. Lag causing placement rollback?
5. Mineflayer placeBlock() succeeding but server rejecting?

**Investigation Needed**:
- Test chest placement at different coordinates (farther from base)
- Check if other bots see the chest before it disappears
- Try /setblock command instead of survival placement
- Monitor server console for block break events

**Resolution**:
- ✅ WORKAROUND FOUND: Chest placement successful at (10,87,5) - away from base coordinates
- Chest is stable and persistent at new location
- Theory: Coordinates near (2,~105-106,~0) may have corruption or anti-cheat issues
- All bots now directed to use chest at (10,87,5) for pearl storage

---
