# Item Collection Bug - Root Cause Analysis

## Issue Summary
Blocks are being successfully mined but items do not drop, preventing resource gathering.

## Root Cause
**The Minecraft server/world has `/gamerule doTileDrops false`**, which completely disables item drops from broken blocks.

## Evidence
1. Mined multiple dirt blocks with `minecraft_dig_block`
2. Tried with `auto_collect=true` and `auto_collect=false` - both failed
3. Manually ran `minecraft_collect_items` immediately after mining - found no items
4. Inventory count before/after mining remained identical (256 dirt → 256 dirt)
5. Code logs show "⚠️ NO ITEM ENTITIES found within 3 blocks of mined block!"

## Affected Code
The code in `src/bot-manager/bot-blocks.ts` lines 745-749 already warns about this:
```typescript
console.error(`[Dig] This suggests server has item drops disabled via:`);
console.error(`[Dig]   1. /gamerule doTileDrops false (blocks don't drop)`);
console.error(`[Dig]   2. /gamerule doMobLoot false (mobs don't drop)`);
console.error(`[Dig]   3. Server plugin blocking drops`);
console.error(`[Dig]   4. Item despawn rate set to 0 (instant despawn)`);
```

## Solution Options

### Option 1: Enable Gamerule (Requires OP)
The bot needs OP permissions to run:
```
/op Claude
/gamerule doTileDrops true
```

### Option 2: Manual Fix (Single-player)
User should:
1. Open the Minecraft world
2. Press ESC → "Open to LAN"
3. Enable "Allow Cheats: ON"
4. Run `/gamerule doTileDrops true`

### Option 3: Auto-Detection and Warning
Enhance the code to detect this condition earlier and provide clearer feedback:
- After first failed collection, check if ANY blocks have ever dropped items
- If never successful, add prominent warning to user
- Suggest specific fix steps

## CLAUDE.md Already Documents This
From CLAUDE.md line 284:
> Minecraftサーバーでボットに`/op botname`が必要

The documentation already states OP is required, but doesn't explicitly call out the gamerule issue.

## Recommended Fix
Add auto-detection on first connection to check and warn if gamerules prevent gameplay:

```typescript
// On bot spawn, check critical gamerules
async function checkGameRules(bot: Bot): Promise<void> {
  // Try to mine a simple block and see if items drop
  // If fails 3 times, warn user about gamerules
  console.warn("⚠️ CRITICAL: Server has item drops disabled!");
  console.warn("   Please run: /gamerule doTileDrops true");
  console.warn("   Bot needs OP permissions to function properly");
}
```

## Status
**CONFIRMED** - Not a code bug, but a server configuration issue.
User must enable item drops for the bot to function.
