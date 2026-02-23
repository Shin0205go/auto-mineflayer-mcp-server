import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
const { GoalBlock } = goals;
import type { ManagedBot } from "./types.js";
import { isHostileMob, checkGroundBelow } from "./minecraft-utils.js";

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

/**
 * Get brief status after an action (HP, hunger, position, surroundings, dangers)
 * Only returns status if APPEND_BRIEF_STATUS=true (for Mamba agent)
 */
function getBriefStatus(managed: ManagedBot): string {
  if (!APPEND_BRIEF_STATUS) return "";

  const bot = managed.bot;
  const pos = bot.entity.position;
  const hp = bot.health?.toFixed(1) ?? "?";
  const food = bot.food ?? "?";
  const x = Math.floor(pos.x);
  const y = Math.floor(pos.y);
  const z = Math.floor(pos.z);

  const getBlock = (dx: number, dy: number, dz: number) => {
    const block = bot.blockAt(new Vec3(x + dx, y + dy, z + dz));
    return block?.name || "unknown";
  };

  // Check walkable directions
  const dirs = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  const walkable: string[] = [];
  for (const [dir, [dx, dz]] of Object.entries(dirs)) {
    const feet = getBlock(dx, 0, dz);
    const head = getBlock(dx, 1, dz);
    if ((feet === "air" || feet === "water") && (head === "air" || head === "water")) {
      walkable.push(dir);
    }
  }

  // Nearby resources
  const resources: string[] = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        const block = bot.blockAt(new Vec3(x + dx, y + dy, z + dz));
        if (block && (block.name.includes("_ore") || block.name.includes("_log") || block.name === "chest")) {
          resources.push(block.name);
        }
      }
    }
  }

  // Dangers
  const hostiles = Object.values(bot.entities)
    .filter(e => e && isHostileMob(bot, e.name?.toLowerCase() || ""))
    .map(e => {
      const dist = e.position.distanceTo(bot.entity.position);
      return `${e.name}(${dist.toFixed(1)}m)`;
    });

  let status = `\n[HP:${hp} Food:${food} (${x},${y},${z})]`;
  if (walkable.length > 0) status += ` Walk:${walkable.join(",")}`;
  if (resources.length > 0) status += ` Near:${resources.slice(0, 3).join(",")}`;
  if (hostiles.length > 0) status += ` ⚠️DANGER:${hostiles.slice(0, 2).join(",")}`;

  return status;
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get bot position
 */
export function getPosition(managed: ManagedBot): { x: number; y: number; z: number } {
  const pos = managed.bot.entity.position;
  return { x: pos.x, y: pos.y, z: pos.z };
}

/**
 * Basic pathfinding move (internal use)
 */
async function moveToBasic(managed: ManagedBot, x: number, y: number, z: number): Promise<{ success: boolean; message: string; stuckReason?: string }> {
  const bot = managed.bot;
  const targetPos = new Vec3(x, y, z);
  const start = bot.entity.position;
  const distance = start.distanceTo(targetPos);

  // GoalNear with range=2 already handles distance check - pathfinder will immediately
  // complete if within 2 blocks. No need for early return that skips actual movement.
  const goal = new goals.GoalNear(x, y, z, 2);

  return new Promise((resolve) => {
    let resolved = false;
    let noProgressCount = 0;
    // Declare checkInterval first to avoid TDZ issues when event handlers fire early
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    let lastPos = start.clone();
    let pathResetCount = 0;
    let notMovingCount = 0;

    const finish = (result: { success: boolean; message: string; stuckReason?: string }) => {
      if (resolved) return;
      resolved = true;
      if (checkInterval !== null) clearInterval(checkInterval);
      bot.removeListener("goal_reached", onGoalReached);
      bot.removeListener("path_reset", onPathReset);
      bot.removeListener("goal_updated", onGoalUpdated);
      try { bot.pathfinder.setGoal(null); } catch (_) {}
      resolve(result);
    };

    const onGoalReached = async () => {
      // Wait for physics to settle - bot.entity.position may not be updated immediately when event fires
      await delay(200);
      const pos = bot.entity.position;
      // Verify we're actually within range before declaring success
      const actualDist = pos.distanceTo(targetPos);
      if (actualDist < 3) {
        finish({ success: true, message: `Reached destination (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})` });
      }
      // If still too far, let the interval checks handle it
    };

    const onGoalUpdated = async () => {
      // Goal was changed externally; treat as cancellation
      await delay(200);  // Wait for physics to settle
      const pos = bot.entity.position;
      const dist = pos.distanceTo(targetPos);
      if (dist < 3) {
        finish({ success: true, message: `Reached destination (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})` });
      }
    };

    let lastPathResetPos = start.clone();

    const onPathReset = () => {
      // path_reset fires when pathfinder recalculates; with canDig=true this happens
      // frequently as the bot digs through obstacles. Only fail after many consecutive
      // resets without making any spatial progress toward the target.
      const currentPos = bot.entity.position;
      const movedSinceLastReset = currentPos.distanceTo(lastPathResetPos);
      if (movedSinceLastReset > 0.3) {
        // We made progress since last reset - this is normal recalculation
        pathResetCount = 0;
        lastPathResetPos = currentPos.clone();
        return;
      }
      pathResetCount++;
      // Also check if bot is currently digging - digging causes repeated resets
      // while the bot stands still, which is normal behavior
      const isDigging = (bot as any).targetDigBlock != null;
      if (isDigging) {
        // Reset counter during active digging - the bot is making progress
        if (pathResetCount > 4) pathResetCount = 4;
        return;
      }
      if (pathResetCount >= 20) {
        const finalDist = currentPos.distanceTo(targetPos);
        if (finalDist > 3) {
          const yDiff = y - currentPos.y;
          finish({
            success: false,
            message: `Cannot reach target - no path found. Stopped at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks away.`,
            stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "no_path"
          });
        }
      }
    };

    bot.on("goal_reached", onGoalReached);
    bot.on("path_reset", onPathReset);
    bot.on("goal_updated", onGoalUpdated);

    // IMPORTANT: Initialize checkInterval BEFORE setGoal, because setGoal
    // can synchronously fire path_reset, which calls finish() -> clearInterval(checkInterval).
    // If checkInterval is still in TDZ (uninitialized let), this throws
    // "Cannot access 'checkInterval' before initialization".
    checkInterval = setInterval(() => {
      if (resolved) {
        if (checkInterval !== null) clearInterval(checkInterval);
        return;
      }

      const currentPos = bot.entity.position;
      const currentDist = currentPos.distanceTo(targetPos);

      // Distance-based success check (use strict range=2 matching GoalNear, not loose <3)
      // Using <3 caused false success when bot starts within 3 blocks of target without moving
      if (currentDist < 2) {
        finish({ success: true, message: `Reached destination (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)})` });
        return;
      }

      const moved = currentPos.distanceTo(lastPos);
      // Check if bot is actively digging (standing still while breaking a block is progress)
      const isDigging = (bot as any).targetDigBlock != null;
      if (moved < 0.1 && !isDigging) {
        noProgressCount++;
        // Allow more time: 30 checks * 500ms = 15s without any movement or digging
        if (noProgressCount >= 30) {
          const yDiff = y - currentPos.y;
          finish({
            success: false,
            message: `Stuck at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). ${currentDist.toFixed(1)} blocks from target.`,
            stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "obstacle"
          });
          return;
        }
      } else {
        noProgressCount = 0;
        pathResetCount = 0; // Reset path_reset counter on progress
        lastPos = currentPos.clone();
      }

      // Only declare failure if pathfinder is not moving AND not digging AND we've waited enough
      if (!bot.pathfinder.isMoving() && !isDigging && currentDist > 3) {
        notMovingCount++;
        // Wait for at least 10 consecutive checks (5s) before concluding
        if (notMovingCount >= 10) {
          const yDiff = y - currentPos.y;
          finish({
            success: false,
            message: `Pathfinder stopped at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). ${currentDist.toFixed(1)} blocks from target.`,
            stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "pathfinder_stopped"
          });
        }
      } else {
        notMovingCount = 0;
      }
    }, 500);

    // Set the goal AFTER checkInterval is initialized (see comment above)
    bot.pathfinder.setGoal(goal);

    // Increased timeout: min 30s + 1.5s per block + extra for complex paths
    const timeout = Math.max(30000, distance * 1500);
    setTimeout(() => {
      if (!resolved) {
        const finalPos = bot.entity.position;
        const finalDist = finalPos.distanceTo(targetPos);
        if (finalDist < 3) {
          finish({ success: true, message: `Reached destination (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)})` });
        } else {
          finish({
            success: false,
            message: `Movement timeout. Stopped at (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks from target.`,
            stuckReason: "timeout"
          });
        }
      }
    }, timeout);
  });
}

/**
 * MoveTo using pathfinder - simplified version that relies on pathfinder's canDig and allow1by1towers
 */
export async function moveTo(managed: ManagedBot, x: number, y: number, z: number): Promise<string> {
  const bot = managed.bot;
  const start = bot.entity.position;
  const targetPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
  const distance = start.distanceTo(targetPos);

  console.error(`[Move] From (${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)}) to (${x}, ${y}, ${z}), distance: ${distance.toFixed(1)}`);

  // Check if target position is a portal block — delegate to enterPortal()
  // Only if the portal would take us to a DIFFERENT dimension (avoid infinite loop in same dimension)
  const targetBlock = bot.blockAt(targetPos);
  if (targetBlock && (targetBlock.name === "nether_portal" || targetBlock.name === "end_portal")) {
    const currentDim = String(bot.game.dimension);
    const isEndPortal = targetBlock.name === "end_portal";
    const isNetherPortal = targetBlock.name === "nether_portal";
    const alreadyInEnd = currentDim.includes("end");
    const alreadyInNether = currentDim.includes("nether");
    // Skip enterPortal() if already in the same dimension as the portal target
    const shouldSkip = (isEndPortal && alreadyInEnd) || (isNetherPortal && alreadyInNether);
    if (!shouldSkip) {
      console.error(`[Move] Target is a ${targetBlock.name}, delegating to enterPortal()...`);
      try {
        return await enterPortal(managed);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Move] enterPortal() failed: ${errMsg}, falling back to normal pathfinding`);
        // Fall through to normal pathfinding
      }
    }
  }

  // FALLBACK: Check if target is near obsidian frame (portal structure)
  // This handles cases where portal blocks aren't detected but user wants to enter portal
  if (distance < 20) {
    const nearbyObsidian = bot.findBlocks({
      matching: bot.registry.blocksByName["obsidian"]?.id,
      maxDistance: 5,
      count: 10,
    });
    if (nearbyObsidian.length >= 4) {
      // Check for vertical obsidian pattern (portal frame)
      let portalFrameDetected = false;
      for (const pos of nearbyObsidian) {
        const above1 = bot.blockAt(pos.offset(0, 1, 0));
        const above2 = bot.blockAt(pos.offset(0, 2, 0));
        const above3 = bot.blockAt(pos.offset(0, 3, 0));
        if (above1?.name === "obsidian" && above2?.name === "obsidian" && above3?.name === "obsidian") {
          portalFrameDetected = true;
          break;
        }
      }
      if (portalFrameDetected) {
        console.error(`[Move] Obsidian portal frame detected near target, attempting enterPortal()...`);
        try {
          return await enterPortal(managed);
        } catch (err) {
          console.error(`[Move] enterPortal() failed near obsidian frame: ${err}`);
          // Continue with normal pathfinding if portal entry fails
        }
      }
    }
  }
  const isPassableBlock = (name: string) => {
    if (!name) return false;
    const passable = ["air", "cave_air", "void_air", "water",
      "grass", "tall_grass", "fern", "large_fern", "dead_bush",
      "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet",
      "red_tulip", "orange_tulip", "white_tulip", "pink_tulip",
      "oxeye_daisy", "cornflower", "lily_of_the_valley", "sunflower", "lilac", "rose_bush", "peony",
      "sweet_berry_bush", "snow", "vine", "torch", "wall_torch",
      "redstone_torch", "redstone_wall_torch", "soul_torch", "soul_wall_torch",
      "rail", "powered_rail", "detector_rail", "activator_rail",
      "carpet", "white_carpet", "orange_carpet", "magenta_carpet",
      "light_blue_carpet", "yellow_carpet", "lime_carpet", "pink_carpet",
      "gray_carpet", "light_gray_carpet", "cyan_carpet", "purple_carpet",
      "blue_carpet", "brown_carpet", "green_carpet", "red_carpet", "black_carpet",
      "sugar_cane", "kelp", "seagrass", "tall_seagrass",
      "crimson_fungus", "warped_fungus", "crimson_roots", "warped_roots", "nether_sprouts",
      "nether_portal", "end_portal",
      "sign", "wall_sign", "hanging_sign"];
    return passable.includes(name) || name.includes("sign") || name.includes("carpet") || name.includes("button") || name.includes("pressure_plate");
  };

  if (targetBlock && !isPassableBlock(targetBlock.name)) {
    // Target is a solid block - find the best nearby standable position
    console.error(`[Move] Target (${x}, ${y}, ${z}) is solid (${targetBlock.name}), finding standable position nearby...`);

    // Search for standable positions near target - search radius 3
    const candidates: { pos: Vec3; dist: number }[] = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = -3; dy <= 3; dy++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const checkPos = targetPos.offset(dx, dy, dz);
          const block = bot.blockAt(checkPos);
          const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
          // Need 2-block tall passable space to stand
          if (block && isPassableBlock(block.name) &&
              blockAbove && isPassableBlock(blockAbove.name)) {
            // Check there's solid ground below
            const blockBelow = bot.blockAt(checkPos.offset(0, -1, 0));
            if (blockBelow && !isPassableBlock(blockBelow.name)) {
              candidates.push({ pos: checkPos, dist: checkPos.distanceTo(targetPos) });
            }
          }
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);

    // Try candidates (up to 5)
    for (const candidate of candidates.slice(0, 5)) {
      console.error(`[Move] Trying standable position (${candidate.pos.x}, ${candidate.pos.y}, ${candidate.pos.z})`);
      const result = await moveToBasic(managed, candidate.pos.x, candidate.pos.y, candidate.pos.z);
      if (result.success) {
        const isOre = targetBlock.name.includes("ore");
        const suffix = isOre ? ` (near ${targetBlock.name} - use minecraft_dig_block to mine it)` : "";
        return `Moved near ${targetBlock.name} at (${candidate.pos.x.toFixed(1)}, ${candidate.pos.y.toFixed(1)}, ${candidate.pos.z.toFixed(1)})${suffix}` + getBriefStatus(managed);
      }
    }

    // No standable candidate found or all failed - fall through to pathfinder
    // Pathfinder with canDig may be able to dig its way there
    console.error(`[Move] No standable candidate succeeded, falling through to pathfinder for (${x}, ${y}, ${z})`);
  }

  // SAFETY CHECK: Verify ground exists at destination
  const groundCheck = checkGroundBelow(bot, x, y, z, 10);
  if (!groundCheck.safe && groundCheck.fallDistance >= 10) {
    console.error(`[Move] WARNING: No solid ground at destination (${x}, ${y}, ${z}), fall distance: ${groundCheck.fallDistance} blocks`);
  }

  // SAFETY CHECK: If target is significantly lower, prevent fall damage
  // Pathfinder handles moderate height changes with digging/towers (maxDropDown=4)
  // Only block extreme drops (>50 blocks) where pathfinder would likely fail or time out
  // EXCEPTION: Allow if target is water (no fall damage in water)
  const currentY = bot.entity.position.y;
  const targetY = y;
  const fallDistance = currentY - targetY;

  if (fallDistance > 20) {
    // Check if target or nearby blocks are water
    const isWaterNearby = () => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const checkPos = targetPos.offset(dx, dy, dz);
            const block = bot.blockAt(checkPos);
            if (block && block.name === "water") {
              return true;
            }
          }
        }
      }
      return false;
    };

    const isSafeGround = targetBlock && (isPassableBlock(targetBlock.name) || targetBlock.name === "air");
    if (!isSafeGround && !isWaterNearby()) {
      // Target is a solid non-water block and fall is significant - risky
      console.error(`[Move] High fall (${fallDistance.toFixed(0)} blocks) to solid block ${targetBlock?.name || "unknown"}`);
      // Continue anyway - pathfinder may find a safe route
    } else {
      console.error(`[Move] Large descent ${fallDistance.toFixed(0)} blocks allowed (safe ground or water detected)`);
    }
  }

  // Use pathfinder directly - it handles digging and tower building automatically
  const result = await moveToBasic(managed, x, y, z);

  if (result.success) {
    return result.message + getBriefStatus(managed);
  }

  // If pathfinder failed, try emergency dig-through strategy
  console.error(`[Move] Pathfinder failed (${result.stuckReason}), attempting emergency dig-through...`);

  const finalPos = bot.entity.position;
  const finalDist = finalPos.distanceTo(targetPos);
  const heightDiff = y - finalPos.y;

  // Emergency strategy: dig through obstacles in the direction of target
  // Find the first solid block between current position and target
  const direction = targetPos.clone().subtract(finalPos).normalize();

  // Check blocks in line toward target (up to 5 blocks ahead)
  for (let dist = 1; dist <= 5; dist++) {
    const checkPos = finalPos.clone().add(direction.scaled(dist)).floor();
    const block = bot.blockAt(checkPos);

    if (block && block.name !== "air" && block.name !== "cave_air" && block.name !== "water") {
      // Found solid block - try to dig it
      console.error(`[Move] Emergency dig: found ${block.name} at (${checkPos.x}, ${checkPos.y}, ${checkPos.z}), distance ${dist}`);

      try {
        // Import digBlock from bot-blocks
        const { digBlock } = await import("./bot-blocks.js");

        // Helper functions for digBlock
        const simpleMoveToBasic = async (_u: string, mx: number, my: number, mz: number) =>
          moveToBasic(managed, mx, my, mz);
        const simpleGetBriefStatus = (_u: string) => getBriefStatus(managed);

        const digResult = await digBlock(
          managed,
          checkPos.x,
          checkPos.y,
          checkPos.z,
          false, // useCommand
          delay, // delay function
          simpleMoveToBasic, // moveToBasic
          simpleGetBriefStatus, // getBriefStatus
          true // autoCollect
        );

        // After digging, retry movement
        console.error(`[Move] Dig succeeded: ${digResult}, retrying movement...`);
        const retryResult = await moveToBasic(managed, x, y, z);

        if (retryResult.success) {
          return `Dug through ${block.name}, then ${retryResult.message}` + getBriefStatus(managed);
        }
        // If still failed, continue with error message below
        break;
      } catch (digError) {
        console.error(`[Move] Emergency dig failed: ${digError}`);
        // Continue to error message
        break;
      }
    }
  }

  let failureMsg = `Cannot reach (${x}, ${y}, ${z}). Current: (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks away.`;

  // Give specific guidance based on the failure reason
  if (result.stuckReason === "target_higher") {
    const inv = bot.inventory.items();
    const hasScaffold = inv.some(i => ["dirt", "cobblestone", "stone", "planks"].some(b => i.name.includes(b)));
    if (hasScaffold) {
      failureMsg += ` Target is ${heightDiff.toFixed(0)} blocks higher. Try minecraft_pillar_up to climb.`;
    } else {
      failureMsg += ` Target is ${heightDiff.toFixed(0)} blocks higher. Need blocks (dirt, cobblestone) to climb. Collect materials first.`;
    }
  } else if (result.stuckReason === "target_lower") {
    failureMsg += ` Target is ${Math.abs(heightDiff).toFixed(0)} blocks lower. Dig down or find stairs/cave entrance.`;
  } else {
    failureMsg += ` Path blocked. Try moving around obstacles or mining through.`;
  }

  return failureMsg + getBriefStatus(managed);
}

/**
 * Emergency escape - dig straight up until reaching open air (for when trapped underground)
 */
export async function emergencyDigUp(managed: ManagedBot, maxBlocks: number = 30): Promise<string> {
  const bot = managed.bot;
  const startY = Math.floor(bot.entity.position.y);
  const startX = Math.floor(bot.entity.position.x);
  const startZ = Math.floor(bot.entity.position.z);

  console.error(`[EmergencyDigUp] Starting from (${startX}, ${startY}, ${startZ}), max ${maxBlocks} blocks`);

  // Equip pickaxe if available
  const pickaxe = bot.inventory.items().find(i => i.name.includes("pickaxe"));
  if (pickaxe) {
    await bot.equip(pickaxe, "hand");
  }

  let blocksDug = 0;
  let currentY = startY;

  for (let i = 0; i < maxBlocks; i++) {
    currentY++;
    const checkPos = new Vec3(startX, currentY, startZ);
    const block = bot.blockAt(checkPos);

    if (!block || block.name === "air" || block.name === "cave_air" || block.name === "void_air") {
      // Found air - check if we're truly at the surface (can see sky)
      const lightLevel = (block as any).light ?? 0;
      if (lightLevel >= 13 || currentY >= startY + 5) {
        console.error(`[EmergencyDigUp] Reached surface at Y=${currentY}, dug ${blocksDug} blocks`);
        return `Emergency escape successful! Dug ${blocksDug} blocks up to Y=${currentY}. Now at surface.`;
      }
      // Keep going - might just be a cave pocket
      continue;
    }

    // Unbreakable block
    if (block.hardness < 0) {
      return `Hit bedrock or unbreakable block (${block.name}) at Y=${currentY} after digging ${blocksDug} blocks. Cannot escape this way.`;
    }

    // Dig the block
    try {
      await bot.lookAt(new Vec3(startX + 0.5, currentY + 0.5, startZ + 0.5));
      await bot.dig(block, false);  // Don't force dig
      blocksDug++;
      await delay(150); // Brief pause

      // Check if bot fell - if so, wait for them to land
      const botY = Math.floor(bot.entity.position.y);
      if (botY < currentY - 2) {
        console.error(`[EmergencyDigUp] Bot fell, waiting to land...`);
        await delay(1000);
        // Restart from new position
        return emergencyDigUp(managed, maxBlocks - blocksDug);
      }
    } catch (err) {
      console.error(`[EmergencyDigUp] Failed to dig ${block.name} at Y=${currentY}: ${err}`);
      return `Failed to dig through ${block.name} at Y=${currentY} after digging ${blocksDug} blocks. Error: ${err}`;
    }
  }

  return `Dug ${blocksDug} blocks upward but haven't reached surface yet (now at Y=${currentY}). May need to dig more or try a different location.`;
}

/**
 * Pillar up by jump-placing blocks
 */
export async function pillarUp(managed: ManagedBot, height: number = 1, untilSky: boolean = false): Promise<string> {
  const bot = managed.bot;
  const startY = bot.entity.position.y;

  // Check if we have scaffolding blocks - dynamically check if block is solid
  // Exclude ores, valuable blocks, and special blocks
  const excludePatterns = ["_ore", "spawner", "bedrock", "obsidian", "portal",
    "diamond_block", "emerald_block", "gold_block", "iron_block", "netherite_block",
    "ancient_debris", "crying_obsidian", "reinforced_deepslate"];

  const isScaffoldBlock = (itemName: string): boolean => {
    // Remove minecraft: prefix if present
    const cleanName = itemName.replace("minecraft:", "");
    // Exclude valuable/special blocks
    if (excludePatterns.some(p => cleanName.includes(p))) return false;
    // Check if block exists in registry
    const blockInfo = bot.registry.blocksByName[cleanName];
    if (!blockInfo) return false;
    // Must be solid block (boundingBox === 'block')
    return blockInfo.boundingBox === "block";
  };

  const countScaffold = () => bot.inventory.items()
    .filter(i => isScaffoldBlock(i.name))
    .reduce((sum, i) => sum + i.count, 0);

  const scaffoldCount = countScaffold();

  if (scaffoldCount === 0) {
    const inv = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`Cannot pillar up - no scaffold blocks! Need: cobblestone, dirt, stone. Have: ${inv}`);
  }

  // If untilSky is true, use scaffoldCount as max (will stop when sky is reached)
  // Otherwise use the specified height
  const targetHeight = untilSky ? Math.min(scaffoldCount, 50) : Math.min(height, 15); // Safety limit

  // Warn if insufficient blocks for target height
  if (!untilSky && scaffoldCount < targetHeight) {
    console.error(`[Pillar] WARNING: Only ${scaffoldCount} blocks available, but need ${targetHeight}. Will place what we have.`);
  }

  const modeStr = untilSky ? "until sky" : `${targetHeight} blocks`;
  console.error(`[Pillar] Starting: ${modeStr} from Y=${startY.toFixed(1)}, scaffold count: ${scaffoldCount}`);

  // Stop all movement and digging first
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  try {
    bot.stopDigging();
  } catch {
    // Ignore if not digging
  }
  await new Promise(r => setTimeout(r, 500)); // Longer wait to ensure previous operations complete

  // Verify we have solid ground below before starting
  const checkPos = bot.entity.position;
  const checkY = Math.floor(checkPos.y);
  const checkX = Math.floor(checkPos.x);
  const checkZ = Math.floor(checkPos.z);

  // Check multiple Y levels below to find solid ground
  // Start from feet level and go down, also check wider horizontal area
  const groundCheck: Vec3[] = [];
  for (let dy = 0; dy >= -5; dy--) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        groundCheck.push(new Vec3(checkX + dx, checkY + dy, checkZ + dz));
      }
    }
  }

  const isNonSolid = (name: string) => {
    return name === "air" || name === "cave_air" || name === "void_air" ||
           name === "water" || name === "lava" || name.includes("sign") ||
           name.includes("torch") || name.includes("carpet") || name === "snow" ||
           name.includes("ladder") || name.includes("vine");
  };

  let hasGround = false;
  for (const pos of groundCheck) {
    const b = bot.blockAt(pos);
    if (b && !isNonSolid(b.name)) {
      console.error(`[Pillar] Found solid ground: ${b.name} at Y=${pos.y}`);
      hasGround = true;
      break;
    }
  }
  if (!hasGround) {
    // Try emergency dig up instead
    console.error(`[Pillar] No ground found - attempting emergency dig up instead...`);
    return emergencyDigUp(managed, 30);
  }

  let blocksPlaced = 0;

  for (let i = 0; i < targetHeight; i++) {
    // Use Math.floor for all axes consistently
    const curX = Math.floor(bot.entity.position.x);
    const currentY = Math.floor(bot.entity.position.y);
    const curZ = Math.floor(bot.entity.position.z);

    // Check if we've reached open sky (when untilSky mode is enabled)
    if (untilSky) {
      const blockAbove2 = bot.blockAt(new Vec3(curX, currentY + 2, curZ));
      const blockAbove3 = bot.blockAt(new Vec3(curX, currentY + 3, curZ));
      const isOpenAbove = (!blockAbove2 || blockAbove2.name === "air" || blockAbove2.name === "cave_air") &&
                          (!blockAbove3 || blockAbove3.name === "air" || blockAbove3.name === "cave_air");

      if (isOpenAbove) {
        // Check light level to confirm we're at the surface
        const lightLevel = (blockAbove2 as any)?.skyLight ?? (blockAbove3 as any)?.skyLight ?? 0;
        if (lightLevel >= 13 || currentY >= startY + 10) {
          console.error(`[Pillar] Reached open sky at Y=${currentY} (light: ${lightLevel}), placed ${blocksPlaced} blocks`);
          return `Reached sky at Y=${currentY.toFixed(1)} after placing ${blocksPlaced} blocks${getBriefStatus(managed)}`;
        }
      }
    }

    // 1. Dig blocks above if needed (Y+2 and Y+3 for jump clearance)
    for (const yOffset of [2, 3]) {
      const blockAbove = bot.blockAt(new Vec3(curX, currentY + yOffset, curZ));
      if (blockAbove && blockAbove.name !== "air" && blockAbove.name !== "water" && blockAbove.name !== "cave_air") {
        console.error(`[Pillar] Digging ${blockAbove.name} above at Y=${currentY + yOffset}`);
        try {
          const pickaxe = bot.inventory.items().find(i => i.name.includes("pickaxe"));
          if (pickaxe) await bot.equip(pickaxe, "hand");
          bot.clearControlStates();
          await new Promise(r => setTimeout(r, 100));
          await bot.dig(blockAbove);
        } catch (e) {
          console.error(`[Pillar] Dig failed at Y+${yOffset}: ${e}`);
          // Continue anyway - might be able to proceed
        }
      }
    }

    // 2. Equip scaffold block
    const scaffold = bot.inventory.items().find(i => isScaffoldBlock(i.name));
    if (!scaffold) {
      console.error(`[Pillar] Out of blocks after ${blocksPlaced} placed`);
      break;
    }
    await bot.equip(scaffold, "hand");

    // 3. Get block below feet to place against
    // Try multiple candidate positions to find a solid block below
    const feetY = Math.floor(bot.entity.position.y);
    const bx = Math.floor(bot.entity.position.x);
    const bz = Math.floor(bot.entity.position.z);
    const candidates = [
      new Vec3(bx, feetY - 1, bz),
      new Vec3(curX, feetY - 1, curZ),
      new Vec3(bx, feetY - 2, bz),
      new Vec3(curX, feetY - 2, curZ),
    ];
    let blockBelow: ReturnType<typeof bot.blockAt> = null;
    for (const pos of candidates) {
      const b = bot.blockAt(pos);
      if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "water" && b.name !== "void_air") {
        blockBelow = b;
        break;
      }
    }
    if (!blockBelow) {
      console.error(`[Pillar] No block below to place against at Y=${feetY - 1}`);
      break;
    }

    // 4. Jump and place - retry up to 3 times per level
    let placed = false;
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      // Re-center on the block before each attempt
      bot.clearControlStates();
      await new Promise(r => setTimeout(r, 150));

      // Re-fetch blockBelow in case position shifted
      if (attempt > 0) {
        const retryFeetY = Math.floor(bot.entity.position.y);
        const retryX = Math.floor(bot.entity.position.x);
        const retryZ = Math.floor(bot.entity.position.z);
        const retryCandidates = [
          new Vec3(retryX, retryFeetY - 1, retryZ),
          new Vec3(retryX, retryFeetY, retryZ),
        ];
        blockBelow = null;
        for (const pos of retryCandidates) {
          const b = bot.blockAt(pos);
          if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "water" && b.name !== "void_air") {
            blockBelow = b;
            break;
          }
        }
        if (!blockBelow) break;
        await new Promise(r => setTimeout(r, 200));
      }

      // Sneak to stay centered, then jump
      bot.setControlState("sneak", true);
      await new Promise(r => setTimeout(r, 250));

      // Save reference block position before jumping
      const savedBlockPos = blockBelow!.position.clone();

      bot.setControlState("jump", true);

      // Wait for jump to reach peak height before placing
      const jumpBaseY = bot.entity.position.y;
      let prevY = jumpBaseY;
      let peakReached = false;
      await new Promise<void>((resolve) => {
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 10;
          const curY = bot.entity.position.y;
          const rising = curY - jumpBaseY;
          // Place when we've risen enough AND started to fall (peak), or timeout
          if (rising > 0.8 && curY <= prevY) {
            peakReached = true;
            clearInterval(interval);
            resolve();
          } else if (elapsed >= 800) {
            clearInterval(interval);
            resolve();
          }
          prevY = curY;
        }, 10);
      });

      bot.setControlState("jump", false);

      // Only try to place if we reached a reasonable jump height
      if (peakReached || bot.entity.position.y - jumpBaseY > 0.5) {
        try {
          // Re-fetch the block at saved position for a fresh reference
          const freshBlock = bot.blockAt(savedBlockPos) || blockBelow;

          // Place on top of block below (this puts block at feet level, lifting us up)
          await bot.placeBlock(freshBlock!, new Vec3(0, 1, 0));
          blocksPlaced++;
          placed = true;
          console.error(`[Pillar] Placed ${blocksPlaced}/${targetHeight} at Y=${currentY}`);
        } catch (e) {
          console.error(`[Pillar] Place failed (attempt ${attempt + 1}): ${e}`);
          // Wait longer before retry to let bot settle
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        console.error(`[Pillar] Jump too low (${(bot.entity.position.y - jumpBaseY).toFixed(2)}), retrying...`);
        await new Promise(r => setTimeout(r, 300));
      }

      // Keep sneaking until we land on the new block
      await new Promise(r => setTimeout(r, 500));
      bot.setControlState("sneak", false);
      await new Promise(r => setTimeout(r, 300)); // Wait to stabilize
    }

    if (!placed) {
      console.error(`[Pillar] Failed to place block after 3 attempts at level ${i + 1}`);
      break;
    }
  }

  const finalY = bot.entity.position.y;
  const gained = finalY - startY;

  if (gained < 0.5 && blocksPlaced === 0) {
    throw new Error(`Failed to pillar up. No blocks placed. Check: 1) Have scaffold blocks? 2) Solid ground below? 3) Open space above?`);
  }

  // Report partial success clearly
  let result = `Pillared up ${gained.toFixed(1)} blocks (Y:${startY.toFixed(0)}→${finalY.toFixed(0)}, placed ${blocksPlaced}/${targetHeight})`;

  if (blocksPlaced < targetHeight) {
    const remaining = targetHeight - blocksPlaced;
    result += `. PARTIAL: Stopped early (${remaining} blocks short). Reason: ${scaffoldCount < targetHeight ? `Only had ${scaffoldCount} blocks` : 'Placement failed'}`;
  }

  return result + getBriefStatus(managed);
}

/**
 * Flee from danger
 *
 * BUG NOTE (2026-02-14): This function sometimes causes WebSocket connection closure
 * during pathfinding. The root cause appears to be either:
 * 1. Minecraft server disconnecting the bot during movement
 * 2. Mineflayer internal error during pathfinding
 * 3. MCP WebSocket transport not handling bot disconnection gracefully
 *
 * When this occurs, subsequent reconnection attempts via minecraft_connect fail with
 * "Connection closed" error. Workaround: Restart the MCP WS server.
 *
 * TODO: Add better error handling and automatic recovery in MCPWebSocketClientTransport
 */
export async function flee(managed: ManagedBot, distance: number = 20): Promise<string> {
  const bot = managed.bot;

  try {
    // Find nearest hostile (using dynamic registry check)
    const hostile = Object.values(bot.entities)
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
      )[0];

    // Calculate flee direction
    let direction: { x: number; y: number; z: number; scaled: (n: number) => any };
    let fleeFromName: string;

    if (hostile) {
      // Flee away from hostile
      direction = bot.entity.position.minus(hostile.position).normalize();
      fleeFromName = hostile.name || "hostile";
      console.error(`[Flee] Fleeing from ${fleeFromName} at (${hostile.position.x.toFixed(1)}, ${hostile.position.y.toFixed(1)}, ${hostile.position.z.toFixed(1)})`);
    } else {
      // No hostile found - flee in a random direction
      const angle = Math.random() * 2 * Math.PI;
      const vec = new (bot.entity.position as any).constructor(Math.cos(angle), 0, Math.sin(angle));
      direction = vec.normalize();
      fleeFromName = "danger";
      console.error(`[Flee] No hostile found, fleeing in random direction`);
    }

    const fleeTarget = bot.entity.position.plus(direction.scaled(distance));
    const startPos = bot.entity.position.clone();

    const goal = new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3);
    bot.pathfinder.setGoal(goal);

    // Wait for movement with proper completion check
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { bot.pathfinder.setGoal(null); } catch { /* bot may have disconnected */ }
        resolve();
      }, 8000);

      const check = setInterval(() => {
        try {
          const distMoved = bot.entity.position.distanceTo(startPos);

          // Success: moved enough distance or reached target
          if (distMoved >= distance * 0.7 || !bot.pathfinder.isMoving()) {
            clearInterval(check);
            clearTimeout(timeout);
            try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
            resolve();
          }
        } catch {
          // Bot entity may be invalid if disconnected during flee
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 200);
    });

    const distMoved = bot.entity.position.distanceTo(startPos);
    if (hostile) {
      const newDist = bot.entity.position.distanceTo(hostile.position);
      return `Fled from ${fleeFromName}! Now ${newDist.toFixed(1)} blocks away`;
    }
    return `Fled ${distMoved.toFixed(1)} blocks from ${fleeFromName}!`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Flee] Error during flee: ${errMsg}`);
    // Stop all movement controls to prevent stuck state
    try {
      bot.clearControlStates();
      bot.pathfinder.setGoal(null);
    } catch { /* bot may be disconnected */ }
    return `Flee interrupted: ${errMsg}`;
  }
}

/**
 * Explore in a direction looking for a specific biome
 */
export async function exploreForBiome(
  managed: ManagedBot,
  targetBiome: string,
  direction: "north" | "south" | "east" | "west" | "random",
  maxBlocks: number = 200
): Promise<string> {
  const bot = managed.bot;
  const startPos = bot.entity.position.clone();

  // Load minecraft-data for biome lookup
  const minecraftData = await import("minecraft-data");
  const mcData = minecraftData.default(bot.version);

  // Helper to get biome name from ID
  const getBiomeName = (biome: any): string => {
    if (!biome) return "unknown";
    if (biome.name) return biome.name;
    if (biome.id !== undefined) {
      const biomeData = mcData.biomes?.[biome.id] || (mcData as any).biomesArray?.find((b: any) => b.id === biome.id);
      return biomeData?.name || `biome_${biome.id}`;
    }
    return "unknown";
  };

  // Determine direction vector
  let dx = 0, dz = 0;
  switch (direction) {
    case "north": dz = -1; break;
    case "south": dz = 1; break;
    case "east": dx = 1; break;
    case "west": dx = -1; break;
    case "random":
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      const picked = dirs[Math.floor(Math.random() * dirs.length)];
      dx = picked[0];
      dz = picked[1];
      break;
  }

  console.error(`[BotManager] Exploring ${direction} looking for ${targetBiome}`);

  // Walk in steps, checking biome
  const stepSize = 10;  // Smaller step size for more reliable movement
  let traveled = 0;
  let foundBiome: string | null = null;
  let foundAt: Vec3 | null = null;

  while (traveled < maxBlocks) {
    const targetDistance = Math.min(traveled + stepSize, maxBlocks);
    const targetX = startPos.x + dx * targetDistance;
    const targetZ = startPos.z + dz * targetDistance;

    // Move to target
    const goal = new goals.GoalNear(targetX, bot.entity.position.y, targetZ, 3);
    bot.pathfinder.setGoal(goal);

    // Wait for movement (with timeout)
    const moveStart = Date.now();
    let reachedGoal = false;
    while (Date.now() - moveStart < 10000) {  // Reduced timeout
      await delay(500);
      const currentPos = bot.entity.position;
      const distToGoal = Math.sqrt(
        Math.pow(currentPos.x - targetX, 2) + Math.pow(currentPos.z - targetZ, 2)
      );
      if (distToGoal < 5) {
        reachedGoal = true;
        break;
      }
    }
    bot.pathfinder.setGoal(null);

    // Update traveled to actual distance moved
    const currentPos = bot.entity.position;
    traveled = Math.floor(Math.sqrt(
      Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.z - startPos.z, 2)
    ));

    // If we couldn't reach the goal, break to avoid infinite loop
    if (!reachedGoal) {
      const actualMoved = Math.sqrt(
        Math.pow(currentPos.x - startPos.x, 2) + Math.pow(currentPos.z - startPos.z, 2)
      );
      if (actualMoved < 2) {
        // Barely moved, likely stuck
        break;
      }
    }

    // Check current biome
    const block = bot.blockAt(bot.entity.position);
    const currentBiome = getBiomeName(block?.biome);

    // More flexible biome matching
    const biomeLower = currentBiome.toLowerCase();
    const targetLower = targetBiome.toLowerCase();
    const isMatch = biomeLower.includes(targetLower) ||
                   targetLower.includes(biomeLower) ||
                   (targetLower === 'plains' && (biomeLower.includes('plain') || biomeLower === 'meadow')) ||
                   (targetLower === 'forest' && biomeLower.includes('forest')) ||
                   (targetLower === 'desert' && biomeLower.includes('desert'));

    if (isMatch) {
      foundBiome = currentBiome;
      foundAt = bot.entity.position.clone();
      break;
    }

    // Also check for target entities while exploring (sheep in this case)
    const sheep = Object.values(bot.entities).find(e =>
      e && e.name?.toLowerCase() === "sheep" &&
      bot.entity.position.distanceTo(e.position) < 30
    );
    if (sheep) {
      return `Found sheep while exploring! At (${Math.floor(sheep.position.x)}, ${Math.floor(sheep.position.y)}, ${Math.floor(sheep.position.z)}) - current biome: ${currentBiome}`;
    }
  }

  if (foundBiome && foundAt) {
    return `Found ${foundBiome} biome at (${Math.floor(foundAt.x)}, ${Math.floor(foundAt.y)}, ${Math.floor(foundAt.z)}) after exploring ${traveled} blocks ${direction}`;
  }

  const finalPos = bot.entity.position;
  const finalBlock = bot.blockAt(finalPos);
  const finalBiome = getBiomeName(finalBlock?.biome);

  const actualDistance = Math.floor(Math.sqrt(
    Math.pow(finalPos.x - startPos.x, 2) + Math.pow(finalPos.z - startPos.z, 2)
  ));

  // If we barely moved, suggest the bot might be stuck
  if (actualDistance < 5) {
    return `Could only move ${actualDistance} blocks ${direction}. Bot might be stuck or path is blocked. Current biome: ${finalBiome}. Try another direction or clear the path.`;
  }

  return `Explored ${actualDistance} blocks ${direction} (max: ${maxBlocks}). Current biome: ${finalBiome}. Target biome '${targetBiome}' not found. Try another direction.`;
}

/**
 * Dig a 1x2 tunnel in a direction
 * Auto-equips pickaxe, collects items, reports ores found
 */
export async function digTunnel(
  managed: ManagedBot,
  direction: "north" | "south" | "east" | "west" | "down",
  length: number = 10
): Promise<string> {
  const bot = managed.bot;
  const startPos = bot.entity.position.clone();
  const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

  // Direction vectors (no "up" - use pillar_up for that)
  const dirVectors: Record<string, { dx: number; dy: number; dz: number }> = {
    north: { dx: 0, dy: 0, dz: -1 },
    south: { dx: 0, dy: 0, dz: 1 },
    east: { dx: 1, dy: 0, dz: 0 },
    west: { dx: -1, dy: 0, dz: 0 },
    down: { dx: 0, dy: -1, dz: 0 },
  };

  const dir = dirVectors[direction];
  if (!dir) {
    throw new Error(`Invalid direction: ${direction}. Use north/south/east/west/down (for up, use pillar_up)`);
  }

  // Stop all movement and digging first to prevent conflicts
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  try {
    bot.stopDigging();
  } catch {
    // Ignore if not digging
  }
  await new Promise(r => setTimeout(r, 150));

  // Auto-equip best pickaxe
  const pickaxePriority = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe"];
  let equippedTool = "empty hand";
  for (const toolName of pickaxePriority) {
    const tool = bot.inventory.items().find(i => i.name === toolName);
    if (tool) {
      await bot.equip(tool, "hand");
      equippedTool = toolName;
      console.error(`[Tunnel] Equipped ${toolName}`);
      break;
    }
  }

  // Check if we have a pickaxe
  if (equippedTool === "empty hand") {
    const inv = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`Cannot dig tunnel - no pickaxe! Need: wooden/stone/iron pickaxe. Have: ${inv}. Craft a pickaxe first.`);
  }

  let blocksDug = 0;
  const oresFound: Record<string, number> = {};
  const currentPos = {
    x: Math.floor(startPos.x),
    y: Math.floor(startPos.y),
    z: Math.floor(startPos.z)
  };

  console.error(`[Tunnel] Starting ${direction} tunnel from (${currentPos.x}, ${currentPos.y}, ${currentPos.z}), length ${length}`);

  for (let i = 0; i < length; i++) {
    // Calculate next position
    const nextX = currentPos.x + dir.dx;
    const nextY = currentPos.y + dir.dy;
    const nextZ = currentPos.z + dir.dz;

    // For horizontal tunnels, dig 2 blocks high (feet and head level)
    // For down tunnels (stairs), dig 1 block
    const blocksToDig: Array<{ x: number; y: number; z: number }> = [];

    if (direction === "down") {
      blocksToDig.push({ x: nextX, y: nextY, z: nextZ });
    } else {
      // Horizontal: dig at feet level and head level
      blocksToDig.push({ x: nextX, y: nextY, z: nextZ });      // feet
      blocksToDig.push({ x: nextX, y: nextY + 1, z: nextZ });  // head
    }

    // Check for lava ahead before digging
    let lavaAhead = false;
    for (const blockPos of blocksToDig) {
      // Check the block itself and adjacent blocks for lava
      const checkPositions = [
        { x: blockPos.x, y: blockPos.y, z: blockPos.z },
        { x: blockPos.x + dir.dx, y: blockPos.y, z: blockPos.z + dir.dz }, // one block further
        { x: blockPos.x, y: blockPos.y + 1, z: blockPos.z }, // above
        { x: blockPos.x, y: blockPos.y - 1, z: blockPos.z }, // below
      ];
      for (const pos of checkPositions) {
        const checkBlock = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
        if (checkBlock?.name === "lava") {
          lavaAhead = true;
          console.error(`[Tunnel] ⚠️ LAVA detected at (${pos.x}, ${pos.y}, ${pos.z})! Stopping.`);
          break;
        }
      }
      if (lavaAhead) break;
    }

    if (lavaAhead) {
      const msg = `🚨 溶岩を検知！トンネル中断 (${blocksDug}ブロック掘削済み)。溶岩が前方にあります。別方向に掘るか撤退してください。`;
      console.error(`[Tunnel] ${msg}`);
      return msg;
    }

    for (const blockPos of blocksToDig) {
      const block = bot.blockAt(new Vec3(blockPos.x, blockPos.y, blockPos.z));
      if (!block || block.name === "air" || block.name === "water" || block.name === "lava") {
        continue;
      }

      // Track ores
      if (block.name.includes("_ore")) {
        oresFound[block.name] = (oresFound[block.name] || 0) + 1;
      }

      // Check if unbreakable
      if (block.hardness < 0) {
        console.error(`[Tunnel] Hit unbreakable block: ${block.name}`);
        continue;
      }

      try {
        // Look at and dig the block
        await bot.lookAt(new Vec3(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5));
        await bot.dig(block, true);
        blocksDug++;

        // Brief pause for item spawn
        await delay(100);
      } catch (err) {
        console.error(`[Tunnel] Failed to dig ${block.name}: ${err}`);
      }
    }

    // Move forward into the tunnel
    if (direction === "down") {
      // For down, just wait for gravity
      await delay(300);
    } else {
      // Horizontal: use pathfinder to move into the tunnel
      const goal = new goals.GoalBlock(nextX, nextY, nextZ);
      bot.pathfinder.setGoal(goal);

      // Wait for pathfinder to reach goal or timeout (max 5 seconds per block)
      try {
        await Promise.race([
          new Promise<void>((resolve) => {
            const onReached = () => {
              bot.removeListener('goal_reached', onReached);
              resolve();
            };
            bot.on('goal_reached', onReached);
          }),
          delay(5000)
        ]);
      } catch (err) {
        console.warn(`[Tunnel] Movement timeout, continuing...`);
      } finally {
        bot.pathfinder.setGoal(null);
      }
    }

    // Update current position
    currentPos.x = nextX;
    currentPos.y = nextY;
    currentPos.z = nextZ;

    // Check HP periodically
    if (bot.health < 8) {
      console.error(`[Tunnel] HP low (${bot.health}), stopping`);
      break;
    }
  }

  // Final item collection
  await delay(500);
  const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
  const itemsCollected = inventoryAfter - inventoryBefore;

  // Build result message
  const finalPos = bot.entity.position;
  let result = `Tunneled ${blocksDug}/${length} blocks ${direction} with ${equippedTool}.`;
  result += ` Position: (${Math.floor(finalPos.x)}, ${Math.floor(finalPos.y)}, ${Math.floor(finalPos.z)}).`;

  // Report if stopped early
  if (blocksDug < length) {
    const reason = bot.health < 8 ? "HP too low" : "Movement/digging failed";
    result += ` PARTIAL: Stopped at ${blocksDug}/${length} (${reason}).`;
  }

  result += ` Items collected: ${itemsCollected}.`;

  if (Object.keys(oresFound).length > 0) {
    const oreList = Object.entries(oresFound).map(([name, count]) => `${name}x${count}`).join(", ");
    result += ` ORES FOUND: ${oreList}!`;
  }

  const newInventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
  result += ` Inventory: ${newInventory || "empty"}`;

  return result;
}

/**
 * Mount an entity (horse, boat, etc.)
 */
export async function mount(managed: ManagedBot, entityName?: string): Promise<string> {
  const bot = managed.bot;

  // Check if entity is mountable using pattern matching
  // Includes: horses, donkeys, mules, pigs (with saddle), striders, boats, minecarts, camels, llamas
  const isMountable = (name: string): boolean => {
    const patterns = ["horse", "donkey", "mule", "pig", "strider", "boat", "minecart", "camel", "llama"];
    return patterns.some(p => name.includes(p));
  };

  const searchName = entityName?.toLowerCase();

  const entity = Object.values(bot.entities)
    .filter(e => {
      if (!e || e === bot.entity) return false;
      const name = (e.name || "").toLowerCase();
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist > 5) return false;

      if (searchName) {
        return name.includes(searchName);
      }
      return isMountable(name);
    })
    .sort((a, b) =>
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
    )[0];

  if (!entity) {
    const hint = entityName ? entityName : "horse, donkey, pig, boat, minecart, camel, llama";
    throw new Error(`No mountable entity (${hint}) found within 5 blocks.`);
  }

  try {
    bot.mount(entity);
    return `Mounted ${entity.name || "entity"}.`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to mount ${entity.name}: ${errMsg}`);
  }
}

/**
 * Dismount from current vehicle
 */
export async function dismount(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;
  const vehicle = (bot as any).vehicle;

  if (!vehicle) {
    return "Not mounted on anything.";
  }

  const vehicleName = vehicle.name || "vehicle";

  try {
    bot.dismount();
    return `Dismounted from ${vehicleName}.`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to dismount: ${errMsg}`);
  }
}

/**
 * Enter a Nether portal and teleport to the Nether/Overworld
 */
export async function enterPortal(managed: ManagedBot, portalType?: "nether_portal" | "end_portal"): Promise<string> {
  const bot = managed.bot;
  const startDimension = bot.game.dimension;

  // Determine which portal type to look for
  // Default: try end_portal first if in overworld near stronghold, otherwise nether_portal
  const searchTypes = portalType
    ? [portalType]
    : ["end_portal", "nether_portal"] as const;

  // Find nearest portal block (end or nether)
  let portalBlock = bot.findBlock({
    matching: (block) => searchTypes.includes(block.name as any),
    maxDistance: 20,
  });

  // FALLBACK: If portal blocks not detected, search for obsidian frame pattern (end_portal_frame for End portal)
  if (!portalBlock) {
    console.error(`[Portal] Portal blocks not detected, searching for frame...`);

    // Check for end_portal_frame first (End portal in stronghold)
    const endFrameBlock = bot.findBlock({
      matching: (block) => block.name === "end_portal_frame",
      maxDistance: 20,
    });
    if (endFrameBlock) {
      console.error(`[Portal] Found end_portal_frame at (${endFrameBlock.position.x}, ${endFrameBlock.position.y}, ${endFrameBlock.position.z})`);
      portalBlock = endFrameBlock;
    } else {
      // Fallback to nether portal obsidian frame search
      const obsidianBlocks = bot.findBlocks({
        matching: bot.registry.blocksByName["obsidian"]?.id,
        maxDistance: 20,
        count: 50,
      });

      // Look for vertical obsidian columns (nether portal frame pattern)
      for (const pos of obsidianBlocks) {
        const block = bot.blockAt(pos);
        if (!block) continue;

        let verticalCount = 1;
        for (let dy = 1; dy <= 4; dy++) {
          const above = bot.blockAt(pos.offset(0, dy, 0));
          if (above?.name === "obsidian") verticalCount++;
          else break;
        }

        if (verticalCount >= 3) {
          const airOffsets = [
            new Vec3(1, 1, 0), new Vec3(-1, 1, 0),
            new Vec3(0, 1, 1), new Vec3(0, 1, -1),
          ];
          for (const offset of airOffsets) {
            const portalPos = pos.plus(offset);
            const innerBlock = bot.blockAt(portalPos);
            if (innerBlock && (innerBlock.name === "nether_portal" || innerBlock.name === "air")) {
              console.error(`[Portal] Found obsidian frame, targeting inside: (${portalPos.x}, ${portalPos.y}, ${portalPos.z})`);
              portalBlock = innerBlock;
              break;
            }
          }
          if (portalBlock) break;
        }
      }
    }

    if (!portalBlock) {
      throw new Error("No end_portal, nether_portal, or portal frame found within 15 blocks");
    }
  }

  // Find the lowest portal block in this portal (bottom of the portal opening)
  // The bot needs its feet inside a portal block, so target the lowest one
  let lowestPortal = portalBlock;
  for (let dy = -1; dy >= -3; dy--) {
    const below = bot.blockAt(portalBlock.position.offset(0, dy, 0));
    if (below && (below.name === "nether_portal" || below.name === "end_portal")) {
      lowestPortal = below;
    } else {
      break;
    }
  }

  console.error(`[Portal] Found portal at (${lowestPortal.position.x}, ${lowestPortal.position.y}, ${lowestPortal.position.z}), bot at (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)})`);

  // Determine the active portal block name
  const activePortalName = lowestPortal.name === "end_portal" ? "end_portal" : "nether_portal";

  // Check if bot is already inside the portal block
  const botBlockPos = bot.entity.position.floored();
  const blockAtFeet = bot.blockAt(botBlockPos);
  const alreadyInPortal = blockAtFeet?.name === activePortalName;
  if (alreadyInPortal) {
    console.error(`[Portal] Bot is already inside ${activePortalName} block, waiting for dimension change...`);
  }

  // Temporarily allow stepping on portal blocks (normally avoided to prevent accidental teleport)
  const netherPortalId = bot.registry.blocksByName["nether_portal"]?.id;
  const endPortalId = bot.registry.blocksByName["end_portal"]?.id;

  try {
    if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.delete(netherPortalId);
    if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.delete(endPortalId);

    if (!alreadyInPortal) {
      // Determine portal axis (nether_portal has state.axis = "x" or "z")
      // axis "x" = portal faces east/west, enter from north/south (Z direction)
      // axis "z" = portal faces north/south, enter from east/west (X direction)
      const portalState = lowestPortal.getProperties() as any;
      const portalAxis = portalState?.axis as string | undefined;
      console.error(`[Portal] Portal axis: ${portalAxis}`);

      // Approach positions based on portal axis
      // For axis "x": portal opening faces Z direction → approach from Z±
      // For axis "z": portal opening faces X direction → approach from X±
      // For end_portal: no axis, try all directions
      let approaches: Vec3[];
      const px = lowestPortal.position.x + 0.5;
      const py = lowestPortal.position.y;
      const pz = lowestPortal.position.z + 0.5;

      if (portalAxis === "x") {
        // Enter from Z direction (north/south)
        approaches = [
          new Vec3(px, py, pz),           // center
          new Vec3(px, py, pz - 1),       // approach from south
          new Vec3(px, py, pz + 1),       // approach from north
          new Vec3(px, py, pz - 0.5),
          new Vec3(px, py, pz + 0.5),
        ];
      } else if (portalAxis === "z") {
        // Enter from X direction (east/west)
        approaches = [
          new Vec3(px, py, pz),           // center
          new Vec3(px - 1, py, pz),       // approach from east
          new Vec3(px + 1, py, pz),       // approach from west
          new Vec3(px - 0.5, py, pz),
          new Vec3(px + 0.5, py, pz),
        ];
      } else {
        // Unknown axis or end_portal: try all directions
        approaches = [
          new Vec3(px, py, pz),
          new Vec3(px, py, pz - 1),
          new Vec3(px, py, pz + 1),
          new Vec3(px - 1, py, pz),
          new Vec3(px + 1, py, pz),
        ];
      }

      // First: use GoalBlock to move directly onto the portal block
      try {
        const goalBlock = new goals.GoalBlock(lowestPortal.position.x, lowestPortal.position.y, lowestPortal.position.z);
        await bot.pathfinder.goto(goalBlock);
        await new Promise(r => setTimeout(r, 500));
        const currentBlock = bot.blockAt(bot.entity.position.floored());
        if (currentBlock?.name === activePortalName) {
          console.error(`[Portal] Bot entered ${activePortalName} via GoalBlock`);
        }
      } catch (e) {
        console.error(`[Portal] GoalBlock failed: ${e}, trying GoalNear`);
        const goal = new goals.GoalNear(lowestPortal.position.x, lowestPortal.position.y, lowestPortal.position.z, 1);
        await bot.pathfinder.goto(goal);
      }

      // Force walk into the portal block center — retry from axis-appropriate angles
      for (let attempt = 0; attempt < 5; attempt++) {
        const currentBlock = bot.blockAt(bot.entity.position.floored());
        if (currentBlock?.name === activePortalName) {
          console.error(`[Portal] Bot is in ${activePortalName} block on attempt ${attempt}`);
          break;
        }
        const target = approaches[attempt] || new Vec3(px, py, pz);
        await bot.lookAt(target);
        bot.setControlState("forward", true);
        bot.setControlState("sprint", false);
        await new Promise(r => setTimeout(r, 1000));
        bot.setControlState("forward", false);
        await new Promise(r => setTimeout(r, 300));

        console.error(`[Portal] Attempt ${attempt + 1}: feet at ${bot.blockAt(bot.entity.position.floored())?.name}, trying different angle...`);
      }
    }

    // Wait for dimension change (teleport) — portals need ~4s standing inside
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Portal teleport timeout after 30 seconds"));
      }, 30000);

      const onSpawn = () => {
        const newDimension = bot.game.dimension;
        if (newDimension !== startDimension) {
          cleanup();
          const dimName = String(newDimension).includes("nether") ? "Nether" :
                         String(newDimension).includes("overworld") ? "Overworld" :
                         String(newDimension).includes("end") ? "End" : String(newDimension);
          resolve(`Teleported to ${dimName} via portal. Position: (${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)})`);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        bot.removeListener("spawn", onSpawn);
        // Re-add portals to blocksToAvoid after transition
        if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(netherPortalId);
        if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(endPortalId);
      };

      bot.on("spawn", onSpawn);
    });
  } catch (err) {
    // Re-add portals to blocksToAvoid on failure
    if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(netherPortalId);
    if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(endPortalId);
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to enter portal: ${errMsg}`);
  }
}
