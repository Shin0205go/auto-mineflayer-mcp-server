/**
 * mc_execute - Code Execution
 *
 * Agents write raw mineflayer JavaScript.
 * Exposed: bot (raw mineflayer), Movements, goals, Vec3, log(), wait(), getMessages()
 */

import { botManager } from "../bot-manager/index.js";
import { currentBotContext } from "../bot-manager/bot-core.js";
import { getSurroundings } from "../bot-manager/bot-info.js";
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

  // aborted flag — set true on timeout so wait() rejects, terminating zombie async functions
  let aborted = false;

  const logFn = (message: unknown) => { if (logs.length < MAX_LOG_LINES) logs.push(String(message)); };
  const waitFn = (ms: number) => new Promise<void>((resolve, reject) => {
    if (aborted) { reject(new Error("Execution aborted")); return; }
    const timer = setTimeout(() => {
      if (aborted) reject(new Error("Execution aborted"));
      else resolve();
    }, Math.min(ms, MAX_WAIT_MS));
    // Store timer so it can be cleared (optional, not strictly needed)
    void timer;
  });
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
    // Pathfinder timeout wrapper utility (usage: await pathfinderGoto(goal, 30000))
    pathfinderGoto: (goal: any, timeoutMs = 30000) => {
      const gotoPromise = (rawBot.pathfinder.goto as any)(goal);
      return Promise.race([
        gotoPromise,
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error(`Pathfinder timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
    },
    // Multi-stage pathfind: break long distances into waypoints
    // Usage: await multiStagePathfind(targetX, targetZ, 10)
    multiStagePathfind: async (targetX: number, targetZ: number, stageDistance: number = 10) => {
      const startPos = rawBot.entity.position;
      const dx = targetX - startPos.x;
      const dz = targetZ - startPos.z;
      const totalDist = Math.sqrt(dx*dx + dz*dz);

      if (totalDist <= stageDistance) {
        // Close enough, just go directly
        const gotoPromise = (rawBot.pathfinder.goto as any)(new goals.GoalXZ(targetX, targetZ));
        return Promise.race([
          gotoPromise,
          new Promise<void>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`Pathfinder timeout after 20000ms`)), 20000)
          )
        ]);
      }

      // Calculate waypoints
      const numStages = Math.ceil(totalDist / stageDistance);
      logFn(`Multi-stage pathfind: ${totalDist.toFixed(1)} blocks in ${numStages} stages`);

      // Navigate each stage
      for (let i = 1; i <= numStages; i++) {
        const frac = i / numStages;
        const wpX = startPos.x + dx * frac;
        const wpZ = startPos.z + dz * frac;

        logFn(`Stage ${i}/${numStages}: (${Math.floor(wpX)}, ${Math.floor(wpZ)})`);

        const gotoPromise = (rawBot.pathfinder.goto as any)(new goals.GoalXZ(wpX, wpZ));
        try {
          await Promise.race([
            gotoPromise,
            new Promise<void>((_resolve, reject) =>
              setTimeout(() => reject(new Error(`Pathfinder timeout after 20000ms`)), 20000)
            )
          ]);
        } catch (e) {
          logFn(`Stage ${i} failed: ${String(e).substring(0, 60)}`);
          throw e;
        }
      }
    },
    // === Meta-cognition layer: observe → understand → act ===
    // awareness() — self-state + spatial snapshot (call before any action)
    awareness: () => {
      return getSurroundings(rawBot);
    },
    // scan3D(radius?, heightRange?) — 3D spatial scan with layer views
    // Shows XZ slices at multiple Y levels + cavity/wall analysis
    scan3D: (radius: number = 5, heightRange: number = 4) => {
      const r = Math.min(radius, 10);
      const hr = Math.min(heightRange, 8);
      const pos = rawBot.entity.position;
      const cx = Math.floor(pos.x);
      const cy = Math.floor(pos.y);
      const cz = Math.floor(pos.z);

      // Block character map for compact display
      const charOf = (name: string | undefined): string => {
        if (!name || name === "air" || name === "cave_air") return " ";
        if (name === "water") return "~";
        if (name === "lava") return "!";
        if (name.includes("log") || name.includes("wood")) return "T";
        if (name.includes("leaves")) return "L";
        if (name.includes("ore")) return "*";
        if (name === "chest") return "C";
        if (name === "crafting_table") return "W";
        if (name === "furnace") return "F";
        if (name.includes("torch")) return "t";
        if (name === "grass_block" || name === "dirt") return ".";
        if (name === "stone" || name.includes("deepslate")) return "#";
        if (name === "sand" || name === "gravel") return ":";
        return "█";
      };

      const lines: string[] = [];
      lines.push(`## 3Dスキャン (${2*r+1}x${2*r+1}, Y=${cy-hr}~${cy+hr}, 中心: ${cx},${cy},${cz})`);
      lines.push(`凡例:  =空気 ~=水 !=溶岩 #=石 .=土 T=木 *=鉱石 █=固体 @=自分`);
      lines.push(``);

      // Scan all blocks into 3D array
      const blocks: Record<string, string> = {};
      for (let dy = -hr; dy <= hr; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            const block = rawBot.blockAt(new Vec3(cx + dx, cy + dy, cz + dz));
            blocks[`${dx},${dy},${dz}`] = block?.name || "air";
          }
        }
      }

      // Key Y layers: below feet, feet, head, above head
      const keyLayers = [
        { dy: -2, label: "足元-2 (地下)" },
        { dy: -1, label: "足元-1 (直下)" },
        { dy: 0,  label: "足元 (Y=" + cy + ")" },
        { dy: 1,  label: "頭 (Y=" + (cy+1) + ")" },
        { dy: 2,  label: "頭上+1" },
      ].filter(l => l.dy >= -hr && l.dy <= hr);

      for (const layer of keyLayers) {
        lines.push(`### ${layer.label}`);
        // Header row with Z offsets
        let header = "    ";
        for (let dz = -r; dz <= r; dz++) {
          header += dz === 0 ? "V" : (Math.abs(dz) <= 1 ? String(dz) : (dz % 2 === 0 ? String(Math.abs(dz) % 10) : " "));
        }
        lines.push(header);

        for (let dx = -r; dx <= r; dx++) {
          const prefix = dx === 0 ? " >" : "  ";
          let row = prefix + String(dx).padStart(2) + " ";
          for (let dz = -r; dz <= r; dz++) {
            if (dx === 0 && dz === 0 && layer.dy === 0) {
              row += "@";  // Bot position
            } else {
              const name = blocks[`${dx},${layer.dy},${dz}`];
              row += charOf(name);
            }
          }
          lines.push(row);
        }
        lines.push(``);
      }

      // === 3D structural analysis ===
      lines.push(`### 構造分析`);

      // Cavity detection: air blocks below feet level
      const cavities: string[] = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          // Check if ground has cavity (air below the top solid block)
          const groundName = blocks[`${dx},-1,${dz}`];
          const belowGround = blocks[`${dx},-2,${dz}`];
          if (groundName && groundName !== "air" && groundName !== "cave_air" &&
              belowGround && (belowGround === "air" || belowGround === "cave_air")) {
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist <= r) {
              cavities.push(`(${cx+dx},${cy-2},${cz+dz})`);
            }
          }
        }
      }
      if (cavities.length > 0) {
        lines.push(`空洞 (足元-2に空気): ${cavities.length}箇所${cavities.length <= 5 ? " " + cavities.join(" ") : ""}`);
      }

      // Drop risk: air below feet at bot's walking level
      const dropRisks: string[] = [];
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const atFeet = blocks[`${dx},0,${dz}`];
          const belowFeet = blocks[`${dx},-1,${dz}`];
          if ((atFeet === "air" || atFeet === "cave_air") &&
              (belowFeet === "air" || belowFeet === "cave_air")) {
            const dist = Math.sqrt(dx*dx + dz*dz);
            if (dist <= r && dist > 0) {
              dropRisks.push(`(${cx+dx},${cz+dz})`);
            }
          }
        }
      }
      if (dropRisks.length > 0) {
        lines.push(`落下リスク (穴): ${dropRisks.length}箇所${dropRisks.length <= 5 ? " " + dropRisks.join(" ") : ""}`);
      }

      // Wall thickness in 4 cardinal directions
      const wallDirs = [
        { name: "北(Z-)", dx: 0, dz: -1 },
        { name: "南(Z+)", dx: 0, dz: 1 },
        { name: "東(X+)", dx: 1, dz: 0 },
        { name: "西(X-)", dx: -1, dz: 0 },
      ];
      const wallInfo: string[] = [];
      for (const dir of wallDirs) {
        let thickness = 0;
        let hitSolid = false;
        for (let i = 1; i <= r; i++) {
          const feetBlock = blocks[`${dir.dx * i},0,${dir.dz * i}`];
          const headBlock = blocks[`${dir.dx * i},1,${dir.dz * i}`];
          const isPassable = (!feetBlock || feetBlock === "air" || feetBlock === "water") &&
                             (!headBlock || headBlock === "air" || headBlock === "water");
          if (!isPassable && !hitSolid) {
            hitSolid = true;
            thickness = 1;
          } else if (!isPassable && hitSolid) {
            thickness++;
          } else if (isPassable && hitSolid) {
            break; // Wall ended
          }
        }
        if (hitSolid) {
          wallInfo.push(`${dir.name}:壁${thickness}ブロック`);
        } else {
          wallInfo.push(`${dir.name}:通路`);
        }
      }
      lines.push(`壁: ${wallInfo.join(", ")}`);

      // Height map for terrain leveling (surface Y per XZ)
      lines.push(``);
      lines.push(`### 高さマップ (整地用)`);
      let totalTopY = 0, topCount = 0;
      let surfMinY = 999, surfMaxY = -999;
      const surfHeights: Record<string, number> = {};
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dy = hr; dy >= -hr; dy--) {
            const name = blocks[`${dx},${dy},${dz}`];
            if (name && name !== "air" && name !== "cave_air" && name !== "water" && name !== "lava") {
              const absY = cy + dy;
              surfHeights[`${dx},${dz}`] = absY;
              totalTopY += absY;
              topCount++;
              if (absY < surfMinY) surfMinY = absY;
              if (absY > surfMaxY) surfMaxY = absY;
              break;
            }
          }
        }
      }
      const avgY = topCount > 0 ? Math.round(totalTopY / topCount) : cy;
      let toDig = 0, toFill = 0;
      for (const [, y] of Object.entries(surfHeights)) {
        if (y > avgY) toDig += (y - avgY);
        if (y < avgY) toFill += (avgY - y);
      }
      lines.push(`平均Y: ${avgY}, 高低差: ${surfMaxY - surfMinY}, 掘る: ${toDig}, 埋める: ${toFill}`);

      return lines.join("\n");
    },

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
    // Set execute flag ONLY during actual code execution to prevent race conditions
    managed.mcExecuteActive = true;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => { aborted = true; reject(new Error(`Execution timed out after ${effectiveTimeout}ms`)); }, effectiveTimeout)
      );
      const result = await Promise.race([fn(...values), timeoutPromise]);
      const elapsed = Date.now() - startTime;

      // Cancel any ongoing pathfinder navigation to prevent zombie goto() from previous execution
      try { rawBot.pathfinder.setGoal(null); } catch {}

      const parts: string[] = [];
      if (result !== undefined && result !== null) {
        try { parts.push(`Result:\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`); }
        catch { parts.push(`Result: ${String(result)}`); }
      }
      if (logs.length > 0) parts.push(`Logs:\n${logs.join("\n")}`);
      parts.push(`Executed in ${elapsed}ms`);
      return parts.join("\n\n");
    } finally {
      // Clear execute flag when code execution finishes (success or error)
      managed.mcExecuteActive = false;
    }

  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Cancel any ongoing pathfinder navigation (especially on timeout — stops zombie goto())
    try { rawBot.pathfinder.setGoal(null); } catch {}

    const parts = [`Error: ${errorMessage}`];
    if (logs.length > 0) parts.push(`Logs before error:\n${logs.join("\n")}`);
    parts.push(`Failed after ${elapsed}ms`);
    console.error(`[mc_execute] Error: ${errorMessage}`);
    return parts.join("\n\n");
  }
}
