## [2026-04-02] CRITICAL BUG: Mining triggers respawn/teleport to Y=101

### Issue
- During vertical mining descent (dig + jump loop)
- Progress: Y=99 → Y=74 → Y=51 → Y=27 ✓
- Then suddenly: Y=27 → Y=100/101 (spawn location)
- Happens consistently after ~30 mining steps

### Reproduction
```javascript
// Mining loop that triggers teleport
for (let step = 0; step < 160; step++) {
  const below = bot.blockAt(currentPos.offset(0, -1, 0));
  await bot.dig(below);  // Step 20-30: Works
  // Step 30: dig succeeds at Y=27
  // After jump: teleported to Y=101
}
```

### Observations
1. Teleport happens around Y=27 (spawn is Y=101)
2. Happens during dig + jump sequence
3. Not triggered by eat() this time (no food consumed)
4. Likely server-side death detection or spawn protection

### Impact
- **BLOCKS: Cannot reach Y=-59 diamond mining**
- All descent attempts fail due to respawn
- Every mining run restarts at Y=101

### Root Cause Hypothesis
- Server detects "player below spawn" or "too far from spawn" → auto-respawn
- Or: Rapid dig + fall triggers false death detection
- Or: Water/suffocation mechanic misfires

### For Code-Reviewer
- Check bot-manager respawn event handlers
- Investigate whether bot is taking "damage" during dig that triggers respawn
- May need to add safeguards: prevent mining below Y=0, or handle respawn event explicitly

### Status
**CRITICAL: Blocks entire diamond mining mission. Needs urgent fix.**

### Workaround
- Cannot reach Y=-59 safely with current game/bot state
- Mission on pause until respawn teleport is fixed
