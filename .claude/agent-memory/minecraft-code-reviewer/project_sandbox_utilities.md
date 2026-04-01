---
name: mc_execute sandbox utilities
description: Sandbox utilities injected into mc_execute context — what exists and why
type: project
---

# mc_execute Sandbox Utilities (src/tools/mc-execute.ts)

## Navigation
- `pathfinderGoto(goal, timeoutMs?)` — timeout wrapper around bot.pathfinder.goto(). Calls setGoal(null) on timeout to kill zombie pathfinder. Retries with canDig=true on "No path" (but NOT on "goal was changed" — that indicates external interference).
- `multiStagePathfind(x, z, stageDistance?)` — breaks long distances into waypoints. Also calls setGoal(null) on stage timeout.
- `escapeWater()` — swim up + navigate to nearest land

## Block Interaction
- `safePlaceBlock(refBlock, faceVec)` — bypasses mineflayer's 5s blockUpdate timeout by using raw `_client.write("block_place", ...)` + 300ms sync
- `fillHoles(radius?)` — fills fall-risk holes with cobblestone/dirt
- `pillarUp(height?)` — builds pillar under bot by jumping + raw block_place (no blockUpdate timeout). Returns { placed, startY, finalY }. Added 2026-04-01. NOTE: bot.pillarUp() does NOT exist on mineflayer Bot — always use this helper.

## Items / Crafting / Farming
- `collectDrops(radius?)` — post-dig/combat item collection. Waits up to 4s for drop entities, then pathfinds to each.
- `recipesFor(itemId, meta?, minResultCount?)` — wraps bot.recipesFor() but auto-finds nearby crafting table (≤6 blocks) to return 3x3 recipes too. 3rd arg is minResultCount (default 1) = inventory filter for N crafts worth of materials.
- `craftWithTable(itemName, count?)` — reliable crafting helper. Calls activateBlock(table) + waits for windowOpen event (1s timeout), then calls bot.craft(). Fixes the 40% windowOpen timeout failure in raw bot.craft(). IMPORTANT: always passes minResultCount=1 to recipesFor (not count) to avoid "no recipe found" when bot has single-craft materials. Also adds slot[0] recovery (shift-click) for laggy servers where putAway(0) fails. Returns { crafted, count, tableUsed }. Fixed 2026-04-01.
- `smeltItems(furnaceBlock, inputItemName, fuelItemName, count?)` — opens furnace via bot.openFurnace() (NOT openContainer), puts fuel+input, waits for smelted output, returns { input, fuel, outputCount }. outputBefore is recorded to avoid false early-resolve when furnace had pre-existing output. Added 2026-04-01, fixed 2026-04-01.
- `plantSeeds(farmlandBlock, seedItemName?)` — equips seeds + places via raw block_place packet (500ms fallback). Avoids bot.placeBlock() 5s blockUpdate timeout. NOTE: bot.place()/bot.interact() do NOT exist. Added 2026-04-01, fixed from bot.placeBlock to raw packet 2026-04-01.

## Eating
- `eat()` — uses activateItem + waits for "health" event (avoids entity_status timeout in bot.consume())

## Meta-cognition
- `awareness()` — calls getSurroundings(), returns self-state + nearby entities/blocks
- `scan3D(radius?, heightRange?)` — 3D spatial scan with layer views
- `safetyState` — getter (not static property) returning managed.safetyState ?? null. Fixed from static capture to getter 2026-04-01 to avoid null race condition on first call.

## Known issues (as of 2026-04-01)
- bot.placeBlock() still uses mineflayer's 5s blockUpdate timeout internally — use safePlaceBlock() or plantSeeds() instead
- bot.recipesFor() often returns [] when no table passed — use recipesFor() wrapper
- bot.recipesFor(id, null, count, table) returns [] when ingredients < count — always use 1 as minResultCount for recipe detection
- bot.craft(recipe, count, table) called directly fails ~40% with windowOpen timeout — use craftWithTable() instead
- craftWithTable() was previously passing count as minResultCount to recipesFor() — fixed 2026-04-01 to always use 1
- goals import: uses `import pathfinderPkg from "mineflayer-pathfinder"` (default import) same as bot-core.ts
- bot.combat("cow") does NOT exist — use bot.attack(entity) + collectDrops()
- bot.pillarUp() does NOT exist — use pillarUp() sandbox helper
- bot.build("shelter") does NOT exist — implement manually
