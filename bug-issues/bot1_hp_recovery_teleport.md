## [2026-04-02] Bug: HP recovery via eat() triggers teleport to spawn

### Issue
- After eating bread (bot.health < 8), bot teleports to Y=101 (spawn location)
- From Y=23, ate bread, suddenly appeared at Y=101
- Likely eat() function or health recovery event triggers respawn logic incorrectly

### Coordinates
- Before eat: (?, 23, ?)
- After eat: (?, 101, ?) - spawn location

### Reproduction
```javascript
// At Y=23 with HP=8.6
const bread = bot.inventory.items().find(i => i.name === 'bread');
if (bread) {
  await bot.equip(bread, 'hand');
  await eat();  // Expected: HP recovery. Actual: Teleport to Y=101
}
```

### Root Cause
- eat() function likely monitors health event and may be misinterpreting respawn event
- Or server-side death detection falsely triggered due to damage

### Impact
- Cannot use food for HP recovery during deep mining without risking teleport to spawn
- Makes Y=-59 diamond mining impossible (requires HP heal due to fall damage)

### Status
- CRITICAL: Blocks entire diamond mining mission
- Alternate: Find food source underground (animals) before eating, or avoid HP damage altogether

### For Code-Reviewer
- Investigate eat() implementation in mc-execute.ts sandbox injection
- Check if health event or respawn event is misfiring
- May need to add safeguards: log position before/after eat(), or use different recovery method
