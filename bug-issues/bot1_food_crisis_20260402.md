## [2026-04-02 01:30] Bug: Critical Food Crisis - System Failure

**Status:** CRITICAL - Game unplayable

### Cause
Multiple cascading failures preventing food acquisition:

1. **Pathfinder Loop Failure**: 
   - Repeated timeouts attempting navigation from (26, 101, 3) to Chest at (8, 92, 5)
   - Distance: 21.5m
   - Error: "Pathfinder timeout after 10000ms" (repeated 3+ times)
   - Terrain appears blocked or navigation deadlocked

2. **Food Availability**:
   - Hunger dropped: 6→4→2 over ~4 minutes
   - Chest unreachable (pathfinder fails)
   - Farm at (11, 101, 11) has no mature wheat
   - No animals nearby
   - No wood in immediate vicinity

3. **openChest() API Issue**:
   - When chest far away, event never fires
   - Error: "Event windowOpen did not fire within timeout of 20000ms"

### Sequence
1. Started with Hunger=6/20, at posi ~(11, 101, 11)
2. Explored for animals - found none
3. Hunger dropped to 4/20
4. Attempted pathfind to chest (8, 92, 5) - TIMEOUT
5. Hunger dropped to 2/20
6. Sent emergency chat message
7. Tried manual Vec3(8, 92, 5) for chest access - openChest() timeout
8. Cannot proceed

### Coordinates
- Current: (14.1, 101.0, 9.7)
- Chest: (8, 92, 5) [blocked by pathfinder]
- Farm: (11, 101, 11) [no harvest]

### Error Messages
- Pathfinder: "Timeout after 15000ms" (3+ occurrences)
- openChest: "Event windowOpen did not fire within timeout of 20000ms"

### Analysis
**Fundamental blocker**: 
- Pathfinder cannot solve routing from north to south in base
- May indicate terrain desync or blocked passages
- Requires code review of Movements initialization

### Status
**UNRECOVERABLE** - Starvation imminent. Requires either:
- Code fix to pathfinder
- Manual admin /give food command
- World reset
