## Bug: Enchanting Table putTargetItem fails with "invalid operation"

### Status: OPEN

### Symptoms
- Claude1 at (27, 101, 5), enchanting_table at (5, 106, -5)
- HP=11.67 (low), XP level=20
- `bot.openEnchantmentTable(block)` succeeds
- `table.putTargetItem(pickaxe)` fails with error: "invalid operation"
- `bot.moveSlotItem(slot42, 0)` also fails with "invalid operation"
- `window.click()` approach also fails

### Root Cause Analysis
The mineflayer EnchantmentTable API appears to have an incompatibility or bug where:
1. The enchanting table window opens successfully (confirmed: `bot.currentWindow.type === 'minecraft:enchantment'`)
2. The window has 38 slots (0-37), with diamond_pickaxe at window slot 35 (player hotbar)
3. Attempts to move items into slot 0 (target) or slot 1 (lapis) fail with "invalid operation"
4. This occurs regardless of:
   - Item source slot (hotbar 42, window slot 35, main inventory)
   - API method used (putTargetItem, moveSlotItem, window.click)
   - Item type (tested with diamond_pickaxe)

### Environment
- Mineflayer version: (check package.json)
- Server version: 1.20.x
- Bot: Claude1
- Coordinates: (5, 106, -5)

### Last Actions
1. Navigated to enchanting table at (5, 106, -5)
2. Called `bot.openEnchantmentTable(et)`
3. Called `table.putTargetItem(pickaxe)` → "invalid operation"
4. Called `bot.moveSlotItem(42, 0)` → "invalid operation"
5. Called `window.click(35, false, 0)` → "invalid operation"

### Workaround Attempted
- Move pickaxe from hotbar to main inventory before opening table → still failed
- Use window.click() instead of putTargetItem → still failed
- Both item transfer methods return "invalid operation"

### Impact
- Cannot enchant items
- Blocks progression toward Ender Dragon phase (need Sharpness/Efficiency/Protection enchants)
- XP is available (level 20), lapis is available (64x), but cannot be applied

### Next Steps for Code Reviewer
1. Check mineflayer's EnchantmentTable implementation (check if API changed in recent version)
2. Verify Minecraft protocol compatibility for enchanting window
3. Consider alternative approach: use raw protocol packets instead of high-level API
4. Check if window needs special permissions or if there's a race condition

### Code to Reproduce
```javascript
const pos = new Vec3(5, 106, -5);
const et = bot.blockAt(pos);
const table = await bot.openEnchantmentTable(et);
await wait(1500);
const pickaxe = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
await table.putTargetItem(pickaxe);  // Fails: "invalid operation"
```
