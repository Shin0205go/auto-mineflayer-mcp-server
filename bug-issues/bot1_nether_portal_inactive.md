## [2026-04-02] Bug: Nether Portal Remains Inactive After Activation Attempt

- **Cause**: Nether portal frame exists (3x4 obsidian, nether_portal blocks inside) but refuses to teleport bot to Nether dimension when activated with flint_and_steel
- **Coordinates**: Portal at (6, 103, 17), Frame: obsidian pillars at X=5,7 / Y=102,105, portal blocks at center
- **Last Actions**:
  1. Bot pathfinded to portal location (6, 103, 17)
  2. Walked into nether_portal block
  3. Verified flint_and_steel in inventory
  4. Called bot.activateBlock() on portal
  5. Waited 2s for dimension transition
- **Error Message**: No error thrown, but bot.game.dimension remains "overworld" after activation
- **Expected**: Dimension should change to "the_nether" after activation
- **Status**: Reported — May need server-side portal reset or exitPortal() helper function for mineflayer
