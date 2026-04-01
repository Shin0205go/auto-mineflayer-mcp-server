## [2026-04-01] CRITICAL BUG: Pathfinder "Took too long" + Food Crisis

**Status**: ACTIVE - Claude1 HP=9/20, Food=5/20, STARVING

### Issue Summary
- **Pathfinder failures**: "Took to long to decide path to goal!" on all medium-range navigations
  - furnace (7,100,-6) from current pos - FAILED
  - wheat (11,102,11) - FAILED
  - chicken (-3,47,-6) - FAILED
  - Any goal >5 blocks away - FAILS within 3000-20000ms

- **Food crisis**: No cooked food in inventory (only wheat_seeds x32, iron_ingotx2, coal x12, etc)
  - Can't navigate to furnace to cook food (pathfinder broken)
  - Can't hunt animals (pathfinder broken)
  - Can't plant & wait (urgent survival situation)

- **Block pathing issues**: `bot.blockFinder` not accessible (undefined)

### Last Actions
1. Harvested 3 wheat_seeds from farmland
2. Attempted pathfinder to furnace at (7,100,-6) - timeout
3. Attempted pathfinder to chicken - timeout
4. Inventory shows 32 wheat_seeds but NO edible items

### Crash Chain
- Pathfinder → No food → No HP recovery → Potential death
- Exact failure: "Took to long to decide path to goal!" in Bot.prototype.pathfinder.goto()

### Suggested Fix
- Review pathfinder canDig/canPlace logic
- Reduce timeout thresholds or add retry with fallback navigation
- Provide simpler manual movement API for emergencies

### Current Coordinates
- Claude1: (-2, 104, -2)
- Furnace nearby: (7, 100, -6)
- Crafting table: (2, 96, -6)
- Still alive but critical state
