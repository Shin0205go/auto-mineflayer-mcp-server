# BUG: validate_survival_environment Reports False Positives

**Date**: 2026-02-14
**Reporter**: Claude2
**Severity**: HIGH - Gives false hope about food availability

## Summary

The `minecraft_validate_survival_environment` tool reports finding passive mobs (specifically chickens) when they don't actually exist, leading agents to believe food sources are available when the environment is actually barren.

## Reproduction Steps

1. Connect to server: `localhost:25565` as `Claude2`
2. Run: `minecraft_validate_survival_environment(username="Claude2", searchRadius=100)`
3. Observe output: `✅ Found chicken (huntable food)`
4. Run: `minecraft_get_nearby_entities(range=100, type="passive")`
5. Observe output: `No passive entities within 100 blocks`

## Actual vs Expected

**Actual Output** (validation tool):
```
=== SURVIVAL ENVIRONMENT VALIDATION ===
Current Hunger: 12/20
Search Radius: 100 blocks

⚠️ LIMITED FOOD SOURCES (1 type found)

Findings:
✅ Found chicken (huntable food)
⚠️ Water found but missing string for fishing rod

Status: Survival possible but challenging. Food scarcity may occur.
```

**Expected Output** (based on actual entity search):
```
❌ CRITICAL: NO FOOD SOURCES DETECTED
- No passive mobs found
- No edible plants found
```

## Root Cause Analysis

### Hypothesis 1: Stale Entity Cache
The `findEntities()` function in `src/bot-manager/bot-info.ts` queries `bot.entities`, which might contain cached/stale entity data from previous sessions or other bots' observations.

**Evidence**:
- `findEntities()` uses `Object.values(bot.entities)` (line 427)
- This reflects what the bot "knows about" historically, not what currently exists
- May include entities that despawned, died, or moved far away

**Code Location**: `src/bot-manager/bot-info.ts:423-472`

### Hypothesis 2: Cross-Bot Entity Sharing
Multiple bots (Claude1, Claude2) may be sharing entity knowledge through the server, causing one bot to report entities seen by another bot in a different location.

## Impact

1. **Misleading Agents**: Agents believe food is available and continue gameplay
2. **Wasted Effort**: Agents search for non-existent mobs
3. **Poor Decision Making**: Agents don't take appropriate action (e.g., requesting admin help)
4. **Trust Erosion**: Makes validation tool unreliable

## Comparison: Tools That Work Correctly

- `minecraft_get_nearby_entities()` - Returns correct, real-time entity data
- Uses fresh entity search, not cached data
- Consistently reports "No passive entities" in this barren environment

## Proposed Fix

### Option 1: Use Real-Time Entity Search
Replace `findEntities()` in validation with the same logic used by `minecraft_get_nearby_entities()`:

```typescript
// BEFORE (in validate_survival_environment)
const entityResult = botManager.findEntities(username, mobType, searchRadius);

// AFTER
const nearbyEntities = botManager.getNearbyEntities(username, searchRadius, "passive");
const hasMobType = nearbyEntities.some(e => e.name.toLowerCase() === mobType.toLowerCase());
```

### Option 2: Clear Entity Cache Before Validation
Force a fresh entity scan by clearing cached data:

```typescript
bot.entities = {}; // Clear cache
await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for rescan
const entityResult = botManager.findEntities(username, mobType, searchRadius);
```

### Option 3: Add Timestamp Validation
Only consider entities seen within the last N seconds:

```typescript
filter(e => {
  if (!e || e === bot.entity) return false;
  const age = Date.now() - e.lastSeenTimestamp;
  if (age > 5000) return false; // Ignore entities older than 5 seconds
  // ... rest of logic
})
```

## Test Case

After implementing fix, this should pass:

```typescript
// Given: Server with mob spawning disabled
const validation = await minecraft_validate_survival_environment("Claude2", 100);
const entities = await minecraft_get_nearby_entities(100, "passive");

// Then: Both should agree on food availability
assert(validation.includes("NO FOOD") === (entities.length === 0));
```

## Related Issues

- [FOOD_SCARCITY_CRITICAL_ISSUE.md](./FOOD_SCARCITY_CRITICAL_ISSUE.md) - Documents the barren environment
- [BUG_REPORT.md](./BUG_REPORT.md) - High-level action timeout issues

## Session Context

- **Bot**: Claude2
- **Position**: (36, 100, 20)
- **HP**: 17.4/20
- **Hunger**: 12/20
- **Time**: 2026-02-14 08:38 JST

---

**Status**: OPEN - Needs investigation and fix
**Priority**: P1 - Affects decision-making reliability
**Next Step**: Investigate `bot.entities` caching behavior
