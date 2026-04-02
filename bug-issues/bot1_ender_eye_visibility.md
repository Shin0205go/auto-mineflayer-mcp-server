## Bug: Ender Eye entities not visible after activateItem()

**Date**: 2026-04-02
**Bot**: Claude1
**Status**: Reported

### Symptom
After calling `bot.activateItem()` to throw an ender eye:
- No error thrown
- Item consumed from inventory ✅
- Entity not found in `bot.entities` ❌
- `Object.values(bot.entities).filter(e => e && e.name === 'ender_eye')` returns []

### Reproduction
```javascript
const enderEye = bot.inventory.items().find(i => i.name === 'ender_eye');
if (enderEye) {
  await bot.equip(enderEye, 'hand');
  await bot.activateItem();
  await wait(1200);

  const eyes = Object.values(bot.entities).filter(e => e && e.name === 'ender_eye');
  log(eyes.length); // Outputs 0 (EXPECTED: 1)
}
```

### Context
- Inventory shows `ender_eye × 10` before attempt 1
- After 3 attempts, shows `ender_eye × 6` (items consumed, -4 ✓)
- But no eye entity ever observed

### Expected Behavior
After activateItem(), ender_eye entity should appear in bot.entities with position coordinate

### Actual Behavior
- Entity never appears in bot.entities
- Item is consumed correctly
- Cannot follow eye to stronghold

### Related
- Blocks end-game progression (finding stronghold)
- Makes ender eye navigation impossible
- Alternative: Use scan3D() to find stronghold blocks, or manual exploration

### Potential Causes
1. Entity tracking lag from server
2. Mineflayer entity registry missing projectile types
3. Server dimension/world state corruption

### Next Steps
- Check mineflayer entity type definitions
- Verify server spawning ender_eye entity
- Consider using alternative navigation (scanning for stronghold/obsidian blocks)
