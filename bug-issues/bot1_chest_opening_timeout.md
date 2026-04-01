## [2026-04-02] Bug: Chest openContainer() Times Out - windowOpen Event Not Firing

- **Cause**: Calling bot.openContainer() on chest block causes "Event windowOpen did not fire within timeout of 20000ms"
- **Coordinates**: Chest at (2, 106, 11), bot at ~(2, 106, 11)
- **Last Actions**:
  1. Pathfinded to chest location
  2. Located chest block at (2, 106, 11)
  3. Called bot.openContainer(chestBlock)
  4. Waited for windowOpen event (timeout 20s)
- **Error Message**: "Event windowOpen did not fire within timeout of 20000ms"
- **Status**: Reported — This is a race condition from prior conversation. activateBlock() should precede openContainer() per recent fix.
