## [2026-04-02] Bug: Unexpected Death and Respawn During Navigation

- **Cause**: Claude1 died during navigation attempt to enchanting table, respawned with HP=20, food=20
- **Coordinates**: Movement sequence (-2,122,-4) → (-5,112,8) → (-4,98,7) → (-4,127.1,-3) → (-4,139,-10) → (-4,145,-10)
- **Last Actions**:
  - Used setControlState() for manual movement (pathfinder timed out)
  - Height Y increased from 112 to 127 to 139 to 145
  - Player appears to have reached ceiling or unloaded chunk
  - After ~3.5 seconds of movement, HP reset to 20 (respawn)
- **Error Message**: None - silent death
- **Status**: Reported
- **Additional Notes**:
  - Possible causes: fall damage, suffocation, or chunk unload
  - setControlState() movement without pathfinder validation is unreliable
  - Recommend: Use teleport or safer movement method, or reduce travel distance with waypoint navigation
