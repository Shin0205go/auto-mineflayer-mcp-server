import type { Bot } from "mineflayer";

export interface SafeGoalOptions {
  /** Max Y-descent before abort (default: 4) */
  maxYDescent?: number;
  /** Monitoring interval in ms (default: 300) */
  intervalMs?: number;
  /** Called when Y-descent abort triggers */
  onAbort?: (yDescent: number, startY: number, currentY: number) => void;
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
  const { maxYDescent = 4, intervalMs = 300, onAbort } = options;
  const startY = bot.entity.position.y;
  const handle: SafeGoalHandle = { cleanup: () => {}, aborted: false, startY };

  bot.pathfinder.setGoal(goal);

  const monitor = setInterval(() => {
    try {
      const yDescent = startY - bot.entity.position.y;
      if (yDescent > maxYDescent) {
        handle.aborted = true;
        clearInterval(monitor);
        try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
        if (onAbort) {
          onAbort(yDescent, startY, bot.entity.position.y);
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
