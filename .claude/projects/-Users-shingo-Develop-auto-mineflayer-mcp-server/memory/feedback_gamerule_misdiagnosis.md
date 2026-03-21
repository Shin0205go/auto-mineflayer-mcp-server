---
name: gamerule-misdiagnosis
description: doMobLoot/doEntityDrops are TRUE on the server. Agent misdiagnosed missing drops as gamerule issue — real cause is likely mc_combat or item collection bug.
type: feedback
---

## Gamerule Misdiagnosis

The Minecraft server has `doMobLoot=true` and `doEntityDrops=true` — the user confirmed this on 2026-03-21.

Previous agent sessions (14-20) incorrectly blamed missing mob drops on disabled gamerules. The real cause of "no drops" is likely:
1. mc_combat not properly killing mobs (damage but no kill)
2. Item collection after kill failing (collectItems bug)
3. Mobs dying out of pickup range
4. Bot moving away before items are collected

**Do NOT report gamerule issues to the user again.** Instead, debug the actual drop/collection code when mob drops are missing.
