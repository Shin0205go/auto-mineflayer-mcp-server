/**
 * mc_execute - Code Execution
 *
 * Agents write raw mineflayer JavaScript.
 * Exposed: bot (raw mineflayer), Movements, goals, Vec3, log(), wait(), getMessages()
 */

import { botManager } from "../bot-manager/index.js";
import { currentBotContext } from "../bot-manager/bot-core.js";
import * as pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

// mineflayer-pathfinder is CJS: Movements is a named ESM export but goals is only on default
const { Movements } = pathfinderPkg;
const goals = (pathfinderPkg as any).default?.goals ?? (pathfinderPkg as any).goals;

const MAX_TIMEOUT = 600_000;
const DEFAULT_TIMEOUT = 120_000;
const MAX_WAIT_MS = 30_000;
const MAX_LOG_LINES = 200;

export async function mc_execute(
  code: string,
  timeout: number = DEFAULT_TIMEOUT,
  username?: string
): Promise<string> {
  if (username && !currentBotContext.getStore()) {
    return currentBotContext.run(username, () => mc_execute(code, timeout, undefined));
  }
  const effectiveTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT);
  const logs: string[] = [];
  const startTime = Date.now();

  // Wait for bot connection
  if (!botManager.isConnected()) {
    if (botManager.isDeathReconnectPending()) {
      console.error(`[mc_execute] death-reconnect pending — waiting up to 8s`);
      try { await botManager.waitForBot(8000); }
      catch { return `Error: death/respawn reconnect timed out after 8s.\n\nFailed after ${Date.now() - startTime}ms`; }
    } else {
      console.error(`[mc_execute] not connected — waiting up to 5s`);
      try { await botManager.waitForBot(5000); }
      catch { console.error(`[mc_execute] still not connected after 5s`); }
    }
  }

  const botUsername = botManager.requireSingleBot();
  const managed = botManager.getBotByUsername(botUsername);
  if (!managed) throw new Error("Bot not connected");
  const rawBot = managed.bot;

  // Signal that mc_execute is running so background handlers (e.g. creeperFlee in physicsTick)
  // do not override the pathfinder goal while agent code is in control.
  managed.mcExecuteActive = true;

  const logFn = (message: unknown) => { if (logs.length < MAX_LOG_LINES) logs.push(String(message)); };
  const waitFn = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.min(ms, MAX_WAIT_MS)));
  const getMessagesFn = () => botManager.getChatMessages(botUsername, true);

  const ctx: Record<string, unknown> = {
    bot: rawBot,
    Movements,
    goals,
    Vec3,
    // Utilities
    log: logFn,
    wait: waitFn,
    getMessages: getMessagesFn,
    // Standard JS
    console: {
      log: (...args: unknown[]) => { if (logs.length < MAX_LOG_LINES) logs.push(args.map(String).join(" ")); },
      error: (...args: unknown[]) => { if (logs.length < MAX_LOG_LINES) logs.push("[error] " + args.map(String).join(" ")); },
      warn: (...args: unknown[]) => { if (logs.length < MAX_LOG_LINES) logs.push("[warn] " + args.map(String).join(" ")); },
    },
    JSON, Math, Date, Array, Object, String, Number, Boolean,
    Map, Set, RegExp, Error, Promise,
    parseInt, parseFloat, isNaN, isFinite,
    setTimeout, setInterval, clearTimeout, clearInterval,
  };

  const keys = Object.keys(ctx);
  const values = Object.values(ctx);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(...keys, `\n${code}\n`);

  console.error(`[mc_execute] Executing code (${code.length} chars, timeout: ${effectiveTimeout}ms)`);

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Execution timed out after ${effectiveTimeout}ms`)), effectiveTimeout)
    );
    const result = await Promise.race([fn(...values), timeoutPromise]);
    const elapsed = Date.now() - startTime;

    // Clear execute flag — background handlers may resume normal operation
    managed.mcExecuteActive = false;

    const parts: string[] = [];
    if (result !== undefined && result !== null) {
      try { parts.push(`Result:\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`); }
      catch { parts.push(`Result: ${String(result)}`); }
    }
    if (logs.length > 0) parts.push(`Logs:\n${logs.join("\n")}`);
    parts.push(`Executed in ${elapsed}ms`);
    return parts.join("\n\n");

  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Clear execute flag even on error
    managed.mcExecuteActive = false;

    const parts = [`Error: ${errorMessage}`];
    if (logs.length > 0) parts.push(`Logs before error:\n${logs.join("\n")}`);
    parts.push(`Failed after ${elapsed}ms`);
    console.error(`[mc_execute] Error: ${errorMessage}`);
    return parts.join("\n\n");
  }
}
