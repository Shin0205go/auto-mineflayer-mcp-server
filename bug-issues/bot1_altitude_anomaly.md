## [2026-04-02] Bug: Altitude Anomaly - Y Coordinate Continuously Increasing

- **Cause**: After respawn and manual movement attempts, Claude1 entered state of continuous altitude increase
- **Coordinates**: Sequence: Y=145 → Y=157.9 → Y=170 → Y=172 → Y=177
- **Last Actions**:
  - Used setControlState() for manual movement after pathfinder timeout
  - Called awareness() - showed Y=157.9, foot-is-air, no ground available
  - Attempted placeBlock() to descend - timed out
  - Used setControlState('forward') while at Y=170 - resulted in Y=177 after 1 second
  - No upward input given, bot moving up automatically
- **Error Message**: blockUpdate timeout, no explicit error on vertical movement
- **Status**: Reported
- **Additional Notes**:
  - Appears to be creative mode or fly mode activated unintentionally
  - setControlState() without ground reference causes divergent behavior
  - Recommend: Hard reset of bot position via admin teleport, or server respawn location validation
  - bot.onGround always undefined despite multiple checks
  - Suggest: Check if bot got stuck in nether or end dimension by mistake (Y values suggest ooverworld ceiling)
