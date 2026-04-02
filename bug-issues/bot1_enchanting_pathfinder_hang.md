## [2026-04-02] Bug: Pathfinder Hang on Navigation to Enchanting Table

- **Cause**: bot.pathfinder.goto() timing out after 120 seconds when navigating from (-2, 122, -4) to enchanting_table at (5, 106, -5)
- **Coordinates**: Start: (-2, 122, -4) → Target: (5, 106, -5) [Distance: 17.1m]
- **Last Actions**:
  - Checked HP (10.75) - dangerous
  - Found food unavailable
  - Attempted pathfinder.goto(GoalNear(5, 105, -5, 2)) → HUNG
  - Fallback attempt to mid-step navigation also hung
- **Error Message**: "Execution timed out after 120000ms"
- **Status**: Reported
- **Additional Notes**: Even step-by-step navigation timed out. Possible pathfinder deadlock or path complexity issue. Recommend: teleport or manual pillar-hop approach
