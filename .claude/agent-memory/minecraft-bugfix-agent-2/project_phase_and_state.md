---
name: Phase Progress - Bot2 (Claude2)
description: Current gameplay phase (Phase 6 Nether) and last known bot2 state
type: project
---

## Current Phase: Phase 6 (Nether)

Goal: Obtain 7 blaze_rod + 12 ender_pearl (ender_pearl already obtained)

## Phase 6 Requirements
1. blaze_rod x7 — NOT OBTAINED (need to find Nether Fortress blaze spawner)
2. ender_pearl x12 — COMPLETE (already in inventory/chest)

## Known Infrastructure
- Overworld Nether portal: (-47 to -44, y=92-96, z=87) - built and active
- Nether Fortress confirmed at: (214, 25, -134) in Nether
- Portal entry spawns at: (-12, 110, 2) in Nether
- Enchanting table: (7, 107, -1)

## Last Known Bot2 State (2026-03-23)
- Bot died multiple times (see bug-issues/bot2.md for detailed death reports)
- keepInventory=true so items are preserved on death
- Multiple deaths from: zombie attacks during movement, navigate without threat check, flee toward enemies bug

## Key Lessons
- NEVER enter Nether without 32+ food items
- flee_at_hp=10 in Nether (not 8) - lava everywhere
- bot.navigate has no threat check - dangerous with enemies nearby
- bot.moveTo has no threat check either
- bot.flee bug: sometimes moves TOWARD enemies instead of away
- Use bot.combat("cow") for food when inventory is empty
