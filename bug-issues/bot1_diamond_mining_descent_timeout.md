## [2026-04-02] Bug: descendSafely() timeout and inefficiency

### Issue
- descendSafely(targetY, maxDigAttempts) takes 60+ seconds and still doesn't reach target Y=-59
- From Y=73 to Y=62 in 20 dig attempts takes ~56 seconds
- Each dig attempt includes terrain analysis and gravity check, causing slowdown
- Estimated time to reach Y=-59 from Y=73: >150 seconds

### Coordinates
- Start: (44, 73, 3)
- Target: Y=-59 (diamond layer)
- Reached: Y=62 (after timeout)

### Root Cause
- descendSafely() implements block-by-block descent with safety checks (maxDigAttempts iterations)
- Each iteration checks gravity, digs one block, waits for landing
- For 135-block descent (Y=73 to Y=-59), 135 iterations * ~0.5s = 67.5 seconds

### Impact
- Cannot efficiently reach diamond mining Y=-59 using descendSafely()
- Alternative strategies needed: freefall with HP recovery, or horizontal cave navigation

### Reproduction
```javascript
const result = await descendSafely(-59, 40);  // Timeout after 60s
log('finalY: ' + result.finalY);  // Y=62, target Y=-59 not reached
```

### Next Steps (for code-reviewer)
- Investigate descendSafely() implementation
- Consider parameterizing skip frequency or adding multi-stage checkpoint logic
- For player: use alternative descent method (freefall, water column, or horizontal cave navigation)

**Status: Reported. Switching to freefall + HP recovery strategy.**
