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
    // On "No path" failure, automatically retries once with canDig=true to handle complex terrain.
    pathfinderGoto: async (goal: any, timeoutMs = 30000) => {
      const tryGoto = (allowDig: boolean) => {
        try {
          if (rawBot.pathfinder?.movements) {
            rawBot.pathfinder.movements.canDig = allowDig;
            // Prevent pathfinder from routing through water — liquidCost=10000 makes water ~2500x
            // more expensive than land. Without this, bots in water-heavy terrain (spawn area near
            // ocean/river) route through water and get stuck mid-lake with no exit.
            (rawBot.pathfinder.movements as any).liquidCost = 10000;
          }
        } catch { /* ignore */ }
        const gotoPromise = (rawBot.pathfinder.goto as any)(goal);
        return Promise.race([
          gotoPromise,
          new Promise<void>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`Pathfinder timeout after ${timeoutMs}ms`)), timeoutMs)
          )
        ]);
      };

      try {
        return await tryGoto(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // On "No path" errors, retry with canDig=true as fallback for complex terrain
        if (msg.includes("No path") || msg.includes("no path") || msg.includes("GoalChanged")) {
          logFn(`[pathfinderGoto] No path with canDig=false, retrying with canDig=true`);
          try {
            return await tryGoto(true);
          } finally {
            // Always restore canDig=false after dig-enabled navigation
            try { if (rawBot.pathfinder?.movements) rawBot.pathfinder.movements.canDig = false; } catch { /* ignore */ }
          }
        }
        throw err;
      }
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
    // === Safe block placement (bypasses blockUpdate timeout) ===
    // Usage: await safePlaceBlock(referenceBlock, faceVector)
    // Uses raw packet directly (~50ms vs 5000ms timeout), then syncs client block cache
    safePlaceBlock: async (referenceBlock: any, faceVector: any) => {
      const pos = referenceBlock.position;
      const direction = faceVector.y === 1 ? 1 : faceVector.y === -1 ? 0 : faceVector.x === 1 ? 5 : faceVector.x === -1 ? 4 : faceVector.z === 1 ? 3 : 2;

      // Ensure we're looking at the target block
      await rawBot.lookAt(pos.offset(0.5, 0.5, 0.5), true);

      // Wait for server block_change to sync client cache (with timeout)
      const placePos = pos.offset(faceVector.x, faceVector.y, faceVector.z);
      const syncPromise = new Promise<void>(resolve => {
        const onBlockUpdate = (oldBlock: any, newBlock: any) => {
          if (newBlock.position.x === placePos.x &&
              newBlock.position.y === placePos.y &&
              newBlock.position.z === placePos.z &&
              newBlock.name !== "air") {
            rawBot.removeListener("blockUpdate", onBlockUpdate);
            resolve();
          }
        };
        rawBot.on("blockUpdate", onBlockUpdate);
        // Timeout: resolve anyway after 300ms
        setTimeout(() => {
          rawBot.removeListener("blockUpdate", onBlockUpdate);
          resolve();
        }, 300);
      });

      // Send raw packet (avoids mineflayer's 5s blockUpdate wait)
      (rawBot as any)._client.write("block_place", {
        location: { x: pos.x, y: pos.y, z: pos.z },
        direction,
        hand: 0,
        cursorX: 0.5,
        cursorY: faceVector.y === 1 ? 1.0 : 0.5,
        cursorZ: 0.5,
        insideBlock: false,
      });

      await syncPromise;
    },
    // === Reliable eat function (bypasses bot.consume() entity_status timeout) ===
    // bot.consume() depends on the server sending entity_status=9 within 2500ms.
    // On high-latency or laggy servers this packet arrives late or is missed,
    // causing "Promise timed out" errors that make food consumption impossible.
    //
    // eat() uses activateItem() via raw use_item packet + waits for food_level_change
    // event (fired when food actually changes) with a 3000ms fallback.
    // This is reliable regardless of entity_status packet delivery.
    //
    // Usage: await eat()   — eats heldItem (equip the food first with bot.equip)
    eat: async () => {
      // Find and equip food automatically
      const foodNames = [
        "golden_apple", "enchanted_golden_apple",
        "cooked_beef", "cooked_porkchop", "cooked_mutton", "cooked_chicken",
        "cooked_rabbit", "cooked_cod", "cooked_salmon",
        "bread", "baked_potato", "pumpkin_pie", "cookie",
        "melon_slice", "sweet_berries", "apple", "carrot",
        "dried_kelp", "beetroot", "potato", "rotten_flesh",
      ];
      let food = rawBot.heldItem && foodNames.includes(rawBot.heldItem.name)
        ? rawBot.heldItem
        : null;
      if (!food) {
        for (const name of foodNames) {
          food = rawBot.inventory.items().find((i: any) => i.name === name) ?? null;
          if (food) break;
        }
      }
      if (!food) throw new Error("No food in inventory");
      await rawBot.equip(food, "hand");

      const itemName = food.name;
      const foodBefore = rawBot.food;

      // Start eating using activateItem (holds use button)
      rawBot.activateItem(false);

      // Wait for food event or timeout (eating takes ~1.61s)
      const eatDone = new Promise<boolean>(resolve => {
        const onFoodChange = () => {
          rawBot.removeListener("health" as any, onFoodChange);
          resolve(true);
        };
        rawBot.on("health" as any, onFoodChange);
        setTimeout(() => {
          rawBot.removeListener("health" as any, onFoodChange);
          resolve(false);
        }, 3500);
      });

      const changed = await eatDone;

      // Stop eating
      rawBot.deactivateItem();

      const foodAfter = rawBot.food;
      logFn(`[eat] ${itemName}: food ${foodBefore} → ${foodAfter}${changed ? "" : " (timeout)"}`);
      return { item: itemName, foodBefore, foodAfter };
    },

    // === Water escape utility ===
    // Usage: const result = await escapeWater()
    // Holds jump + moves toward nearest non-water block to escape water traps.
    // Returns a summary of what happened (surfaced, reached land, or still in water).
    // Call this when bot.entity.position foot=water and pathfinderGoto is unreliable.
    escapeWater: async () => {
      const isWater = (name: string | undefined) => name === "water" || name === "flowing_water";

      const feetBlock = rawBot.blockAt(rawBot.entity.position.floored());
      const headBlock = rawBot.blockAt(rawBot.entity.position.floored().offset(0, 1, 0));
      const startInWater = isWater(feetBlock?.name) || isWater(headBlock?.name);

      if (!startInWater) {
        return "Not in water — no escape needed";
      }

      const startPos = rawBot.entity.position.clone();
      logFn(`[escapeWater] In water at (${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)}). Starting escape.`);

      // Phase 1: Swim up by holding jump for up to 5s
      rawBot.setControlState("jump", true);
      rawBot.setControlState("sprint", true);

      let surfaced = false;
      for (let i = 0; i < 25; i++) {
        await new Promise<void>(r => setTimeout(r, 200));
        const check = rawBot.blockAt(rawBot.entity.position.floored().offset(0, 1, 0));
        if (!isWater(check?.name)) {
          surfaced = true;
          break;
        }
      }

      rawBot.setControlState("jump", false);
      rawBot.setControlState("sprint", false);

      const afterSwimPos = rawBot.entity.position;
      const feetAfter = rawBot.blockAt(afterSwimPos.floored());
      const stillInWater = isWater(feetAfter?.name);

      if (!stillInWater) {
        logFn(`[escapeWater] Surfaced. Now at (${afterSwimPos.x.toFixed(1)}, ${afterSwimPos.y.toFixed(1)}, ${afterSwimPos.z.toFixed(1)})`);

        // Phase 2: Navigate toward land (non-water block at feet+1 level)
        // Search nearby XZ for a land position
        let landX = afterSwimPos.x, landZ = afterSwimPos.z;
        let foundLand = false;
        for (let r = 2; r <= 8 && !foundLand; r++) {
          for (let dx = -r; dx <= r && !foundLand; dx++) {
            for (let dz = -r; dz <= r && !foundLand; dz++) {
              if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
              const checkPos = afterSwimPos.floored().offset(dx, 0, dz);
              const landFeet = rawBot.blockAt(checkPos);
              const landHead = rawBot.blockAt(checkPos.offset(0, 1, 0));
              if (landFeet && !isWater(landFeet.name) && landFeet.name !== "air" &&
                  landHead && (landHead.name === "air" || isWater(landHead.name))) {
                // Solid ground with passable space above
                landX = checkPos.x + 0.5;
                landZ = checkPos.z + 0.5;
                foundLand = true;
              }
            }
          }
        }

        if (foundLand) {
          try {
            if (rawBot.pathfinder?.movements) {
              rawBot.pathfinder.movements.canDig = false;
              (rawBot.pathfinder.movements as any).liquidCost = 10000;
            }
            const goal = new goals.GoalNear(landX, Math.round(afterSwimPos.y), landZ, 1);
            await Promise.race([
              (rawBot.pathfinder.goto as any)(goal),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
            ]);
          } catch { /* ignore pathfinder errors — we're on surface, which is the main goal */ }
        }
      }

      const finalPos = rawBot.entity.position;
      const finalFeet = rawBot.blockAt(finalPos.floored());
      const finalInWater = isWater(finalFeet?.name);

      if (finalInWater) {
        return `Still in water at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}). Try digging sideways or placing blocks to escape.`;
      }

      return `Escaped water. Now at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}) on ${finalFeet?.name ?? "unknown"}.`;
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

    // === Terrain management: fill holes within radius ===
    // Usage: const count = await fillHoles(radius?)  — default radius=6
    // Scans for fall-risk positions (air+air below at foot level) and fills with cobblestone/dirt
    // Only fills blocks within placement reach (4.5 blocks). Skips unreachable holes.
    fillHoles: async (radius: number = 6) => {
      const MAX_PLACE_DIST = 4.5;
      const r = Math.min(radius, 10);
      const pos = rawBot.entity.position;
      const cx = Math.floor(pos.x);
      const cy = Math.floor(pos.y);
      const cz = Math.floor(pos.z);
      let filled = 0;
      let skippedFar = 0;

      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0) continue;
          // Check foot level: air + air below = fall risk
          const atFeet = rawBot.blockAt(new Vec3(cx + dx, cy, cz + dz));
          const below = rawBot.blockAt(new Vec3(cx + dx, cy - 1, cz + dz));
          if (!atFeet || !below) continue;
          if ((atFeet.name !== "air" && atFeet.name !== "cave_air") ||
              (below.name !== "air" && below.name !== "cave_air")) continue;

          // Find support: first solid block going down from foot-1
          let supportY = cy - 2;
          while (supportY > cy - 10) {
            const s = rawBot.blockAt(new Vec3(cx + dx, supportY, cz + dz));
            if (s && s.name !== "air" && s.name !== "cave_air" && s.name !== "water") break;
            supportY--;
          }

          // Fill from support up to foot level
          for (let fy = supportY; fy < cy; fy++) {
            const base = rawBot.blockAt(new Vec3(cx + dx, fy, cz + dz));
            const above = rawBot.blockAt(new Vec3(cx + dx, fy + 1, cz + dz));
            if (!base || !above) continue;
            if (base.name === "air" || base.name === "cave_air") continue;
            if (above.name !== "air" && above.name !== "cave_air") continue;

            // Distance check: server rejects placement beyond ~4.5 blocks
            const blockCenter = base.position.offset(0.5, 1.5, 0.5); // center of placement target
            const dist = blockCenter.distanceTo(rawBot.entity.position);
            if (dist > MAX_PLACE_DIST) { skippedFar++; continue; }

            const cobble = rawBot.inventory.items().find((i: any) => i.name === "cobblestone" || i.name === "dirt");
            if (!cobble) { logFn("[fillHoles] Out of fill material"); return filled; }

            await rawBot.equip(cobble, "hand");
            // Use safePlaceBlock logic (raw packet + sync)
            const bPos = base.position;
            await rawBot.lookAt(bPos.offset(0.5, 0.5, 0.5), true);
            const syncP = new Promise<void>(resolve => {
              const handler = (_o: any, n: any) => {
                if (n.position.x === bPos.x && n.position.y === bPos.y + 1 && n.position.z === bPos.z && n.name !== "air") {
                  rawBot.removeListener("blockUpdate", handler);
                  resolve();
                }
              };
              rawBot.on("blockUpdate", handler);
              setTimeout(() => { rawBot.removeListener("blockUpdate", handler); resolve(); }, 300);
            });
            (rawBot as any)._client.write("block_place", {
              location: { x: bPos.x, y: bPos.y, z: bPos.z },
              direction: 1, hand: 0,
              cursorX: 0.5, cursorY: 1.0, cursorZ: 0.5, insideBlock: false,
            });
            await syncP;
            filled++;
          }
        }
      }
      logFn(`[fillHoles] Filled ${filled} blocks, skipped ${skippedFar} out-of-reach (radius ${r})`);
      return filled;
    },

    // AutoSafety state (read-only from agent code)
    // Getter function so agent always reads the latest state (not a stale snapshot).
    safetyState: managed.safetyState ?? null,

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

  // Apply safe pathfinder defaults for mc_execute sandbox
  // Agents use bot.pathfinder.goto() directly — without these, maxDropDown is unset
  // and pathfinder routes over cliffs causing massive fall damage.
  // maxDropDown=1: Minecraft fall damage starts at >3-block drops (>3 blocks = 0.5HP damage).
  // maxDropDown=2 caused cumulative damage on mountainous terrain (Y=85-120) via repeated 2-block
  // drops. maxDropDown=1 prevents all fall damage while still allowing natural terrain descent.
  try {
    if (rawBot.pathfinder?.movements) {
      rawBot.pathfinder.movements.canDig = false;
      rawBot.pathfinder.movements.maxDropDown = 1;
      rawBot.pathfinder.movements.dontCreateFlow = true;
    }
  } catch { /* pathfinder may not be loaded yet */ }

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
