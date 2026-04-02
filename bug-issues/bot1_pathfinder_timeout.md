## [2026-04-02] Bug: Pathfinder timeout on all distances

### Cause
Pathfinder.goto() consistently times out after 60 seconds, even on short distances (6-20 blocks). Happens repeatedly in post-game cleanup phase.

### Coordinates
Location: (4, 66, 5) overworld
Target: (-2, 70, 3) crafting_table - distance 7 blocks away
Also failed on target (3, 80, 6) chest - distance 6.3 blocks away

### Last Actions
1. Claude1 defeated Ender Dragon
2. Attempted to navigate to nearest chest for storage organization
3. Multiple pathfinder calls all timeout

### Error Message
```
Pathfinder timeout after 60000ms
```

### Context
- Terrain around base is navigable (stone, dirt, andesite blocks present)
- Bot has clear movement capability according to awareness() 
- Multiple pathfinder attempts all fail identically
- This blocks post-game cleanup tasks

### Status
Reported - pathfinder system needs investigation

