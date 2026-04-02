## [2026-04-02] CRITICAL BUG: descendSafely() has major pathfinding/geometry issues

### Problem Summary
`descendSafely()` function is causing:
1. Long timeouts (120s+) while digging
2. Bot ending up at wrong Y-coordinates
3. Bot appearing in End dimension blocks (purpur_stairs, purpur_block) in Overworld
4. Infinite/circular digging patterns

### Incident Log

#### Incident 1: First descent to farmland (Y=56 → target Y=52)
- Called: `await descendSafely(52, 20)`
- Result: Bot ended at Y=141 (End dimension), surrounded by purpur_pillar
- Timeout: 80+ seconds
- Output: `[descendSafely] Dug purpur_pillar at y=142` (repeated)

#### Incident 2: Escape descent (Y=104 → target Y=65)
- Called: `await descendSafely(65, 25)`
- Output logs show:
  ```
  [descendSafely] Dug oak_planks at y=101
  [descendSafely] Dug dirt at y=99
  [descendSafely] Dug stone at y=71
  [descendSafely] Y=72, target=65, attempt=10
  [descendSafely] Dug purpur_stairs at y=139  ← TELEPORTED UPWARD!
  ```
- Timeout: Full 120s timeout
- Bot appears to be jumping between Y=72 and Y=139

### Root Cause Analysis
1. **Geometry corruption**: descendSafely is reading/writing to wrong block positions
2. **Y-coordinate tracking**: Not properly tracking bot's actual Y position during dig loop
3. **Dimension confusion**: Digging into purpur blocks (End-only) in Overworld suggests:
   - Either bot's actual position is in End but reported as Overworld
   - Or block lookup is returning wrong blocks for coordinates
4. **Dig loop stuck**: The function digs, falls, re-checks position, but position tracking is broken

### Code Location
- File: `src/tools/mc-execute.ts` or `src/bot-manager/` (descendSafely helper)
- Function: `await descendSafely(targetY, maxDigAttempts?)`

### Recommendation
**DISABLE descendSafely() temporarily** or rewrite with:
- Rigorous Y-coordinate sanity checks (abort if bot Y changes unexpectedly)
- Dimension detection (abort if in End)
- Max timeout per dig attempt (not total)
- Fallback: if descent fails, use pillar_up to known safe height + pathfinder to base

### Workaround for This Session
- Use simple forward/sideways movement + gravity falls instead of descendSafely
- Use pathfinderGoto directly for long-distance navigation (avoid multi-stage for now)
- Manual block placement to create descent path if needed

### Impact
**Critical** — Blocks all gameplay. Bots cannot safely navigate vertical terrain without getting stuck.
