## [2026-04-02 Session 2] Bug: Phase 6 Enderman Spawn Failure - Recurring Issue

### Situation
- **Phase**: 6 (Enderman hunting for ender_pearl)
- **Current State**:
  - Location: Overworld cave system, Y=59-112 (variable)
  - Time: Night (time >13000, currently ~19500)
  - Light Level: 0 (confirmed dark cave)
  - HP: 15-20/20
  - Food: 17-20/20
  - ender_pearl: 0/2 (mission: obtain 2)
  - blaze_powder: 12 (can craft ender_eye)

### Problem Description
**Enderman not spawning despite all spawn conditions being met:**

1. **Correct Spawn Conditions Confirmed**:
   - ✓ Light Level: 0 (awareness reports "光レベル: 0")
   - ✓ Time: Night (bot.time.timeOfDay > 13000, currently 17724-19500)
   - ✓ Location: Overworld (not End/Nether)
   - ✓ Space Above: Minimum 3 empty blocks confirmed by scan3D
   - ✓ Biome: Unknown (but should spawn in all except Mushroom/Deep Dark)
   - ✓ Altitude: Y=59-112 range (normal spawning range)

2. **Entity Scanning Results**:
   - Search attempts: 5+ independent scans
   - Mobs found: Spiders (1), but **ZERO Endermen**
   - Manual exploration: east, south, west (165.8m), north directions
   - Duration: ~3 hours gameplay time (multiple 60-second waits for spawn)
   - Result: **No Endermen found**

3. **Expected Behavior (per Minecraft Wiki)**:
   - Endermen spawn in groups of 1-2 at night in Overworld
   - Spawn rate is lower than other mobs, but groups SHOULD appear eventually
   - With light level 0 and 3+ hour search window, should have found at least 1-2

### Failed Attempts
1. Ground level exploration (Y=68) → 0 Endermen
2. Deep cave exploration (Y=59) → 0 Endermen
3. Depth variation attempts (Y=87, Y=112) → 0 Endermen
4. Manual walking in 4 cardinal directions → 0 Endermen spawned
5. Waiting through nightcycle progression (ticks 6784→17724) → 0 Endermen
6. Entity array scanning (Object.values(bot.entities).filter(e => e.name === 'Enderman')) → always returns []

### Root Cause Analysis

**This is a duplicate of previously reported issue** (see claude1_phase6_pearl_hunt.md):
- Previous session (2026-04-02 first attempt) reported identical Enderman spawn failure
- Same conditions met, same zero-spawn result
- Suggests systemic issue, not one-time RNG or biome problem

**Possible Root Causes**:
1. **Mineflayer API Detection Bug**: `bot.entities` filter may not properly detect Endermen
   - Other mobs (spiders) ARE detected, so entity detection works
   - Enderman-specific detection or filtering could be broken
   - `e.name === 'Enderman'` may return wrong entity type name

2. **Server-Side Spawn Disabled**: Game server may have mob spawning disabled or filtered
   - No evidence of any other mob spawns either (only spiders in caves)
   - Could be a server setting disabling Enderman specifically
   - Would require `/gamerule doMobSpawning` check (server admin only)

3. **Biome Detection**: Awareness reports "バイオーム: unknown"
   - If biome is incorrectly identified, Enderman spawn rules may not apply
   - Deep Dark biome explicitly prevents Enderman spawn
   - Unknown biome state is suspicious

4. **Dimension Glitch**: Y coordinates are unstable (101→59→87→112 in sequence)
   - Multiple Y jumps suggest pathfinder is unstable or world state is inconsistent
   - Could indicate partially loaded chunks or dimension state issues
   - If world state corrupted, mob spawn registry could be broken

### Coordinates
- Current: (22.5, 112, -16)
- Cave system explored: X=22-158 (west direction), Y=59-112 (variable), Z=-22 to -4
- Cave type: Dark limestone/stone cave system with water sources

### Inventory
- diamond_sword: 1
- shield: 1
- bow: 0 (not in inventory, but should have one somewhere or could craft if needed)
- arrow: 64
- bread: 11
- blaze_powder: 12
- iron_chestplate: 1 (equipped)

### Impact
- **Mission Blocked**: Cannot obtain ender_pearl × 2 without Enderman
- **Phase 6 Cannot Progress**: Ender dragon fight preparation impossible
- **Team Impact**: Phase 7 (Ender dragon) completely blocked
- **Workaround**: Requires either:
  - Fix to Enderman spawn detection
  - Admin `/give ender_pearl 2` command
  - Finding alternative source of ender_pearl (unlikely in vanilla survival)

### Reproduction Steps
1. Connect bot to game server
2. Wait for night (bot.time.timeOfDay > 13000)
3. Navigate to dark cave (light level 0, 3+ empty blocks above)
4. Scan entities: `Object.values(bot.entities).filter(e => e && e.type === 'mob' && e.name === 'Enderman')`
5. **Result**: Always returns empty array

### Previous Session Reference
- File: bug-issues/claude1_phase6_pearl_hunt.md
- Date: 2026-04-02 (same date, earlier session)
- Status: Marked as "STUCK"
- Recommendations:
  - Debug Enderman spawn detection in API
  - Verify server-side spawn settings (/gamerule doMobSpawning)

### Logs Summary
```
Time: 17724, Location: Y=59 (cave), Light: 0
⚠ Endermen nearby: 0
⚠ Failed movement attempts (pathfinder timeout)
⚠ Manual cave exploration 165m+ walked, 0 Endermen found
⚠ Time progression: 6784→10204→12344→17724→19504 (Night confirmed)
```

### Status
**BLOCKED** - Phase 6 stuck on Enderman spawn failure
- Identical to previous session's block
- Standard gameplay mechanics ineffective
- Requires:
  1. Code-reviewer to debug Enderman detection in mineflayer wrapper
  2. Admin verification of `/gamerule doMobSpawning true` on server
  3. Or admin `/give ender_pearl 2` to unblock progression

### Recommendation
1. **Priority 1**: Check server `/gamerule doMobSpawning` status
2. **Priority 2**: Debug `mineflayer.entities` detection for Enderman mob type
3. **Priority 3**: If code-side OK, consider game server spawn-cap issue
