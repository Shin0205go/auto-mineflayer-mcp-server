import type { Bot } from "mineflayer";

export interface SafeGoalOptions {
  /** Max Y-descent before abort (default: 4, or auto if elevationAware=true) */
  maxYDescent?: number;
  /** Monitoring interval in ms (default: 300) */
  intervalMs?: number;
  /** Called when Y-descent abort triggers */
  onAbort?: (yDescent: number, startY: number, currentY: number) => void;
  /**
   * When true, automatically increases maxYDescent for elevated starts (Y>75).
   * Elevated terrain (birch forest hills, mountains) has natural 8-20 block cliffs.
   * A fixed 4-block limit causes all movement to abort on elevated terrain.
   * elevationAware=true: Y<=75 → limit=4, Y>75 → limit=20, Y>90 → limit=(startY-62+5).
   * Session 85: combat/gather deaths from cliff falls on mountain terrain (Y=76-119).
   */
  elevationAware?: boolean;
  /**
   * Absolute minimum Y — abort immediately if bot descends below this value,
   * regardless of maxYDescent. Used by flee() to prevent cumulative cave descent
   * across retries. Session 89: flee() Y=67→60→48 across retries because each
   * retry's startY was the post-descent position, allowing unlimited cumulative drop.
   * absoluteMinY: Math.max(originalStartY - 8, 62) bounds total descent to ≤8 blocks
   * from the flee start point and never below Y=62 (sea level / cave threshold).
   */
  absoluteMinY?: number;
}

export interface SafeGoalHandle {
  /** Stop Y-descent monitoring. Call when movement ends. */
  cleanup: () => void;
  /** Whether the monitor aborted the goal due to Y-descent */
  aborted: boolean;
  /** The start Y being monitored against */
  startY: number;
}

/**
 * Wraps bot.pathfinder.setGoal() with built-in Y-descent monitoring.
 * Returns a handle whose cleanup() must be called when movement ends.
 * If Y drops more than maxYDescent, automatically calls setGoal(null).
 */
export function safeSetGoal(
  bot: Bot,
  goal: any,
  options: SafeGoalOptions = {}
): SafeGoalHandle {
  const { intervalMs = 300, onAbort, elevationAware = false, absoluteMinY } = options;
  const startY = bot.entity.position.y;

  // Compute effective maxYDescent:
  // - If caller specifies explicitly, use that value.
  // - If elevationAware=true, auto-scale based on start elevation.
  //   At Y>90 (mountain peak): allow descent to near sea level (startY-62+5).
  //   At Y>75 (birch forest hills): allow 20-block descent (natural cliff height).
  //   At Y<=75 (flat surface/underground): keep tight 4-block limit.
  let maxYDescent: number;
  if (options.maxYDescent !== undefined) {
    maxYDescent = options.maxYDescent;
  } else if (elevationAware) {
    if (startY > 90) {
      maxYDescent = Math.max(startY - 62 + 5, 20);
    } else if (startY > 75) {
      maxYDescent = 20;
    } else {
      maxYDescent = 4;
    }
  } else {
    maxYDescent = 4;
  }
  const handle: SafeGoalHandle = { cleanup: () => {}, aborted: false, startY };

  bot.pathfinder.setGoal(goal);

  const monitor = setInterval(() => {
    try {
      const currentY = bot.entity.position.y;
      const yDescent = startY - currentY;
      // Check relative descent limit
      const relativeAbort = yDescent > maxYDescent;
      // Check absolute Y floor (prevents cumulative descent across retries)
      const absoluteAbort = absoluteMinY !== undefined && currentY < absoluteMinY;
      if (relativeAbort || absoluteAbort) {
        handle.aborted = true;
        clearInterval(monitor);
        try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
        if (onAbort) {
          onAbort(yDescent, startY, currentY);
        }
      }
    } catch {
      clearInterval(monitor);
    }
  }, intervalMs);

  handle.cleanup = () => {
    clearInterval(monitor);
  };

  return handle;
}
