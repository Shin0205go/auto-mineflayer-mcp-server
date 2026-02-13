# Bug Report: Hunger Death Spiral

## Date
2026-02-13

## Severity
**CRITICAL** - Game becomes unplayable

## Description

The game enters an unrecoverable "death spiral" when all of the following conditions occur simultaneously:

1. Hunger depletes to critical levels (< 6/20)
2. No food in inventory
3. No animals within search range
4. Server has `doMobLoot` disabled (item pickup issues)

## Reproduction Steps

1. Connect to Minecraft server
2. Play until hunger reaches 3/20
3. Try to find food:
   - `minecraft_survival_routine({ priority: "food" })` → "No food sources (animals) found nearby"
   - `minecraft_explore_area({ target: "cow" })` → Aborted due to critical hunger (safety check on line 571)
4. Result: Cannot get food, cannot explore for food, hunger continues to deplete

## Root Cause Analysis

### File: `src/tools/high-level-actions.ts`

**Line 567-573**: Exploration safety check prevents movement when hunger < 6
```typescript
if (food < 6) {
  return `Exploration aborted at ${visitedPoints} points due to critical hunger (${food}/20). Return to safety and eat! Findings so far: ${findings.length > 0 ? findings.join(", ") : "none"}`;
}
```

**Line 439-454**: Survival routine only searches nearby (32 blocks) for animals
```typescript
const nearbyEntities = botManager.findEntities(username, "passive", 32);
if (nearbyEntities.includes("cow") || ...) {
  // hunt animals
} else {
  results.push("No food sources (animals) found nearby");
}
```

**Problem**: When hungry AND no nearby animals, the bot:
1. Cannot explore far to find animals (safety check)
2. Cannot get food from nearby animals (they don't exist)
3. Continues to lose hunger
4. Eventually dies

## Impact

- Game becomes unplayable after ~30 minutes of gameplay
- Bot enters infinite loop of starvation
- Occurred in self-improvement loop #N (see previous log)

## Proposed Solutions

### Solution 1: Emergency Food Mode (Recommended)

Add special case to exploration when hunger is critical:

```typescript
// In minecraft_explore_area()
if (food < 6) {
  // Emergency mode: search nearby only, no long-distance movement
  if (target === "cow" || target === "pig" || target === "chicken" || target === "sheep") {
    // Allow limited short-distance search for food animals
    const emergencyRadius = Math.min(radius, 20); // Max 20 blocks when hungry
    // ... search logic
  } else {
    return `Exploration aborted due to critical hunger...`;
  }
}
```

### Solution 2: Fishing Fallback

When no animals found, automatically try fishing:

```typescript
// In minecraft_survival_routine()
if (selectedPriority === "food") {
  const nearbyEntities = botManager.findEntities(username, "passive", 32);

  if (!nearbyEntities.includes("cow") && /* no animals */) {
    // Try fishing as last resort
    const fishingResult = await botManager.fish(username, 30);
    results.push(`Fishing fallback: ${fishingResult}`);
  }
}
```

### Solution 3: Plant-Based Food

Add plant foraging as emergency food source:

```typescript
// Search for apples, sweet berries, carrots, potatoes
const plantFood = ["apple", "sweet_berries", "carrot", "potato"];
for (const food of plantFood) {
  const blockResult = botManager.findBlock(username, food, 16);
  if (!blockResult.includes("No")) {
    // harvest plant food
  }
}
```

## Recommended Action

Implement **Solution 1** (Emergency Food Mode) immediately, then add Solution 2 (Fishing) as additional safety net.

## Files to Modify

- `src/tools/high-level-actions.ts` (line 567-573, 437-455)

## Test Plan

1. Deplete hunger to 3/20
2. Remove all food from inventory
3. Spawn in area with no animals
4. Call `minecraft_survival_routine({ priority: "food" })`
5. Verify bot can acquire food via emergency mode or fishing

## Status

- [ ] Bug documented
- [ ] Fix implemented
- [ ] Tests passed
- [ ] Committed to git
