## Bug: Crafting Table activateBlock() fails to open window

**Date**: 2026-04-02
**Bot**: Claude1
**Status**: Reported

### Symptom
When calling `bot.activateBlock(table)` on a crafting_table block:
- Returns without error
- `bot.currentWindow` remains null
- Window UI never opens

### Reproduction
```javascript
const table = await bot.findBlock({
  matching: (b) => b.name === 'crafting_table',
  maxDistance: 30
});

if (table) {
  await bot.activateBlock(table);
  await wait(1500);
  if (!bot.currentWindow) {
    log('Window did not open');  // THIS HAPPENS
  }
}
```

### Context
- Coordinates: (0, 73, 7) — confirmed crafting_table exists
- Previous successful craft operations: ???
- Last successful gameplay session: unknown
- HP/Hunger: 13.6/17 (healthy)

### Expected Behavior
Window opens after 1-2 seconds, `bot.currentWindow` is not null

### Actual Behavior
Wait completes, window is not opened, craft operations fail

### Related
- iron_ingot × 27 in inventory, cannot craft armor
- bot.recipesFor('iron_chestplate') returns empty array
- This blocks Phase 2 → Phase 3 progression

### Next Steps
- Check mineflayer activateBlock() implementation
- Verify crafting_table block state / metadata
- Test with furnace or other interactive blocks
- Consider chest-based item organization as workaround
