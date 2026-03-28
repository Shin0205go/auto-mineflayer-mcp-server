/**
 * mc_execute - Code Execution with MCP
 *
 * Instead of calling individual MCP tools, the agent writes JavaScript code
 * that executes against the raw mineflayer bot and pathfinder APIs directly.
 * Enables multiple operations, conditional logic, and loops in a single tool call.
 *
 * Uses node:vm for sandboxed execution with no access to require/process/fs.
 */

import * as vm from "node:vm";
import {
  mc_status,
  mc_chat,
  mc_reconnect,
} from "./core-tools.js";
import { botManager } from "../bot-manager/index.js";
import { currentBotContext } from "../bot-manager/bot-core.js";
import * as pathfinderPkg from "mineflayer-pathfinder";
import { Vec3 } from "vec3";

const { Movements, goals } = pathfinderPkg;

const MAX_TIMEOUT = 600_000;  // 10 minutes max for gameplay loops
const DEFAULT_TIMEOUT = 120_000;  // 2 minutes default
const MAX_WAIT_MS = 30_000;  // 30s per wait call (for crop growth etc)
const MAX_LOG_LINES = 200;

/**
 * Execute JavaScript code against the bot API in a sandboxed context.
 */
export async function mc_execute(
  code: string,
  timeout: number = DEFAULT_TIMEOUT,
  username?: string
): Promise<string> {
  // Multi-bot support: if username provided, run inside AsyncLocalStorage context
  // so requireSingleBot() throughout the call chain routes to the correct bot.
  if (username && !currentBotContext.getStore()) {
    return currentBotContext.run(username, () => mc_execute(code, timeout, undefined));
  }
  const effectiveTimeout = Math.min(Math.max(timeout, 1000), MAX_TIMEOUT);
  const logs: string[] = [];
  const startTime = Date.now();

  // Pre-execution connection check: if bot is not connected but a death-triggered
  // reconnect is pending, wait up to 8s for the reconnect to complete before failing.
  // Bug [2026-03-26]: "mc_execute disconnects after every single call" — after bot death,
  // the Minecraft server briefly disconnects the bot (end event fires), clearing botManager.bots.
  // The death auto-reconnect takes ~3s to complete. Without this wait, any mc_execute call
  // in the reconnect window fails immediately with "Not connected after 1ms".
  if (!botManager.isConnected()) {
    if (botManager.isDeathReconnectPending()) {
      console.error(`[mc_execute] Bot not connected but death-reconnect pending — waiting up to 8s`);
      try {
        await botManager.waitForBot(8000);
        console.error(`[mc_execute] Bot reconnected after death, proceeding with execution`);
      } catch (waitErr) {
        const elapsed = Date.now() - startTime;
        return `Error: Bot disconnected (death/respawn) and auto-reconnect timed out after 8s. Call mc_connect to reconnect manually.\n\nFailed after ${elapsed}ms`;
      }
    } else {
      // Non-death disconnect: bot auto-reconnects after 2s (see bot-core.ts).
      // Wait up to 5s for auto-reconnect to complete before giving up.
      console.error(`[mc_execute] Bot not connected — waiting up to 5s for auto-reconnect`);
      try {
        await botManager.waitForBot(5000);
        console.error(`[mc_execute] Bot reconnected, proceeding with execution`);
      } catch (_waitErr) {
        // Still not connected — fall through to normal requireSingleBot() error
        console.error(`[mc_execute] Bot still not connected after 5s wait`);
      }
    }
  }

  // Get the raw mineflayer bot
  const botUsername = botManager.requireSingleBot();
  const managed = botManager.getBotByUsername(botUsername);
  if (!managed) throw new Error("Bot not connected");
  const rawBot = managed.bot;

  // Build the sandbox
  const sandbox: Record<string, unknown> = {
    // Raw mineflayer bot — full API access
    bot: rawBot,

    // Pathfinder classes
    Movements,
    goals,

    // Vec3 for coordinate construction
    Vec3,

    // Thin helpers (pure query / trivial utility)
    status: async () => {
      const raw = await mc_status();
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    getMessages: () => {
      const msgs = botManager.getChatMessages(botUsername, true);
      return msgs;
    },

    log: (message: unknown) => {
      if (logs.length < MAX_LOG_LINES) {
        logs.push(String(message));
      }
    },

    wait: async (ms: number) => {
      const waitMs = Math.min(ms, MAX_WAIT_MS);
      return new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });
    },

    // Reconnect helper
    reconnect: async () => {
      return await mc_reconnect();
    },

    // chat helper
    chat: async (message: string) => {
      return await mc_chat(message);
    },

    // Standard JS globals
    console: {
      log: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
          logs.push(args.map(String).join(" "));
        }
      },
      error: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
          logs.push("[error] " + args.map(String).join(" "));
        }
      },
      warn: (...args: unknown[]) => {
        if (logs.length < MAX_LOG_LINES) {
          logs.push("[warn] " + args.map(String).join(" "));
        }
      },
    },
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    eval: undefined,
    Function: undefined,
    Proxy: undefined,
    Reflect: undefined,
    import: undefined,
  };

  const context = vm.createContext(sandbox, {
    name: "mc_execute sandbox",
    codeGeneration: { strings: false, wasm: false },
  });

  // Wrap code in an async function so await works
  const wrappedCode = `
(async () => {
${code}
})()
`;

  console.error(`[mc_execute] Executing code (${code.length} chars, timeout: ${effectiveTimeout}ms)`);

  try {
    const script = new vm.Script(wrappedCode, {
      filename: "mc_execute_input.js",
    });

    // vm.Script timeout only works for synchronous code. For async, we need
    // a manual timeout wrapper.
    const resultPromise = script.runInContext(context, {
      timeout: effectiveTimeout,
    });

    // Race the execution against a timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Execution timed out after ${effectiveTimeout}ms`)), effectiveTimeout);
    });

    const result = await Promise.race([resultPromise, timeoutPromise]);

    const elapsed = Date.now() - startTime;

    // Format output
    const parts: string[] = [];

    if (result !== undefined && result !== null) {
      try {
        const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        parts.push(`Result:\n${resultStr}`);
      } catch {
        parts.push(`Result: ${String(result)}`);
      }
    }

    if (logs.length > 0) {
      parts.push(`Logs:\n${logs.join("\n")}`);
    }

    parts.push(`Executed in ${elapsed}ms`);


    return parts.join("\n\n");
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const parts: string[] = [];
    parts.push(`Error: ${errorMessage}`);

    if (logs.length > 0) {
      parts.push(`Logs before error:\n${logs.join("\n")}`);
    }

    parts.push(`Failed after ${elapsed}ms`);

    console.error(`[mc_execute] Error: ${errorMessage}`);
    return parts.join("\n\n");
  }
}
