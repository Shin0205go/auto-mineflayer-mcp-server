## [2026-04-02] CRITICAL BUG: Food Trap - Unrecoverable Starvation

**Status**: ACTIVE - Bot at HP=1.2/20, Food=0/20. DEATH IMMINENT.

### Root Cause
Bot spawned into world with:
- HP=1.2 (critical)
- Food=0/20 (starvation)
- No food items in inventory
- No food items on ground
- No accessible animals (0 nearby)
- No wheat/farmland to harvest
- No leaves to break for apples
- No accessible chests/furnaces due to pathfinder timeouts

### Current State (2026-04-02 Session)
```
Location: Overworld (11, 99, 5)
HP: 1.2/20
Food: 0/20
Inventory: flint_and_steel, sticks×8, iron_ingots×2, coal×12, diamonds×3, shield, stone_pickaxe, arrows×64, diamond_pickaxe, rose_bush, torches×5, birch_log, wheat_seeds×32, diamond_sword, cobblestone×47, stone_hoe
```

### Actions Attempted (All Failed)
1. **Hunt animals** - No animals within scan radius (0/0)
2. **Break oak leaves** - No leaves found (0/0)
3. **Access chest** - Pathfinder timeout ("Took to long to decide path to goal!") at 15m distance
4. **Cook raw meat** - No raw meat in inventory
5. **Plant wheat** - Seeds exist but farmland/growth time unavailable (immediate food needed)
6. **Find dropped food** - No food items on ground (0/0)
7. **Break branches** - No branches accessible

### Key Problem
This appears to be a **world initialization bug** where the bot respawned with critical HP/Food but:
- No immediate food sources exist (animals didn't spawn)
- All food-bearing blocks/items are either destroyed or pathfinder-inaccessible
- AutoSafety's eat() function has no food to work with

### Triggers for Death
Any of these will trigger instant death:
1. One half-heart of damage from fall/mob
2. Continued starvation tick
3. Attempting any movement that causes fall damage

### Impact
**CRITICAL - Session unplayable.** Bot will die in seconds without:
- Admin `/give` intervention
- World reroll
- Magic food source spawn

### Reproduction
Starting fresh session with hunger crisis from prior session (hunger=0, no food items).

### Suggested Fixes
1. **AutoSafety enhancement**: If food=0 and no recoverable food exists, trigger emergency respawn or admin notification
2. **World initialization check**: Verify animals spawn before allowing bot to be placed in overworld
3. **Food guarantee**: Ensure at least 1 cooked meat or bread exists in starting chest
4. **Crafting fallback**: Enable crafting recipes without recipes book in emergency scenarios

### Related Bugs
- `bot1_critical_food_crisis.md`
- `bot1_hunger_crisis_food_trap.md`
- `bot1_starvation_crafting_failure.md`

---
**Report Status**: PENDING CODE REVIEWER ACTION
