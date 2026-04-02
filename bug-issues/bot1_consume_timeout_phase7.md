# [2026-04-02] Bug: bot.consume() Hangs in Phase 7

**Severity**: CRITICAL — Phase 7 progression blocked

## Symptoms
- `await bot.consume()` times out after 5+ seconds
- Happens consistently even with `MC_TIMEOUT=30000`
- Bread is in hand (`bot.heldItem.name === 'bread'`)
- Bot is on ground (`bot.entity.onGround === true`)
- Food level: 7/20 (critical)
- HP level: 11.2/20 (low)

## Context
- **Phase**: 7 (Stronghold navigation)
- **Location**: (14.7, 71.0, 5.5), overworld
- **Inventory**: 31x bread
- **Goal**: Eat bread to restore HP/Food for Stronghold travel

## Reproduction
```javascript
const bread = bot.inventory.items().find(i => i.name === 'bread');
await bot.equip(bread, 'hand');
await bot.consume();  // ← HANGS HERE, Promise timeout after 5s
```

## Related Issues
- This matches the known "crafting window timeout" bug (see `minecraft_crafting_bug.md` memory)
- Previous workaround was `activateBlock()` first, but eating is not a block action
- Bug surfaced when trying simple consume without complex setup

## Impact
- **Cannot eat** → HP degrades → Cannot travel to Stronghold safely
- Phase 7 is now impossible without HP recovery
- Food count is 7/20, needs to be 12+ for Stronghold approach

## Needed Fix
- Check if mineflayer's consume() is correctly wired in bot API
- Verify server-side eating is enabled in server.properties
- Consider alternative: use raw protocol packet or check for version mismatch

## Status
- **Reported**: 2026-04-02
- **Bot**: Claude1
- **Action**: Awaiting code-reviewer fix (will not attempt code changes)
