import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
const { GoalBlock } = goals;
import type { ManagedBot } from "./types.js";
import { isHostileMob, checkGroundBelow, EDIBLE_FOOD_NAMES } from "./minecraft-utils.js";
import { equipArmor } from "./bot-items.js";

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
  const yDelta = y - start.y;

  // SAFETY CHECK: Warn if pathfinding will require dangerous height changes
  // If target is only slightly lower but far horizontally, avoid going up too high
  const horizontalDist = Math.sqrt((x - start.x) ** 2 + (z - start.z) ** 2);
  if (horizontalDist > 5 && yDelta < 0) {
    // Target is lower and far away - pathfinder might go UP first then drop, causing fall damage
    // Safe rule: if target is N blocks away horizontally and M blocks lower,
    // don't go more than 3 blocks UP (risky for falls)
    console.error(`[MoveTo] Safety check: target (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) is ${horizontalDist.toFixed(1)} blocks away horizontally, ${Math.abs(yDelta).toFixed(1)} blocks lower. Pathfinder may try to go UP first (risky). Using ground-level pathfinding if possible.`);
  }

  // GoalNear with range=2 already handles distance check - pathfinder will immediately
  // complete if within 2 blocks. No need for early return that skips actual movement.
  const goal = new goals.GoalNear(x, y, z, 2);

  return new Promise((resolve) => {
    let resolved = false;
    let noProgressCount = 0;
    let maxHeightReached = start.y;
    let underwaterTicks = 0; // Track consecutive checks with head underwater
    // Declare checkInterval first to avoid TDZ issues when event handlers fire early
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    let lastPos = start.clone();
    let pathResetCount = 0;
    let notMovingCount = 0;

    // Collect cleanup callbacks for listeners added after finish() is defined
    const cleanupCallbacks: Array<() => void> = [];

    const finish = (result: { success: boolean; message: string; stuckReason?: string }) => {
      if (resolved) return;
      resolved = true;
      if (checkInterval !== null) clearInterval(checkInterval);
      bot.removeListener("goal_reached", onGoalReached);
      bot.removeListener("path_reset", onPathReset);
      bot.removeListener("goal_updated", onGoalUpdated);
      for (const cb of cleanupCallbacks) cb();
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
      // Reset notMovingCount: during recalculation isMoving() briefly returns false,
      // which would incorrectly increment notMovingCount and cause premature failure.
      notMovingCount = 0;
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

      // SAFETY: Detect falling — if Y dropped >3 blocks since last check, stop immediately
      const yDrop = lastPos.y - currentPos.y;
      if (yDrop > 3) {
        console.error(`[MoveTo] FALL DETECTED: dropped ${yDrop.toFixed(1)} blocks (${lastPos.y.toFixed(1)} → ${currentPos.y.toFixed(1)}). Stopping pathfinder.`);
        finish({
          success: false,
          message: `Navigation stopped: fell ${yDrop.toFixed(1)} blocks at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Unsafe terrain detected.`,
          stuckReason: "fall_detected"
        });
        return;
      }

      // SAFETY: Detect lava contact — stop immediately if in lava
      // Bot2: "tried to swim in lava" — flowing_lava was not detected, only "lava" was checked.
      const blockAtFeet = bot.blockAt(currentPos.floor());
      const blockAtHead = bot.blockAt(currentPos.offset(0, 1, 0).floor());
      const blockBelow = bot.blockAt(currentPos.offset(0, -1, 0).floor());
      const isLava = (name?: string) => name === "lava" || name === "flowing_lava";
      if (isLava(blockAtFeet?.name) || isLava(blockAtHead?.name) || isLava(blockBelow?.name)) {
        bot.pathfinder.stop();
        console.error(`[MoveTo] LAVA DETECTED at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Emergency stop!`);
        finish({
          success: false,
          message: `Navigation stopped: lava detected at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Move away from lava immediately!`,
          stuckReason: "lava_detected"
        });
        return;
      }

      // SAFETY: Detect prolonged water submersion — abort if head is underwater for too long.
      // Bot1 Session 44: pathfinder routed through underground water, bot drowned.
      // liquidCost=10000 discourages water paths but doesn't prevent canDig from opening water caves.
      // 4 consecutive checks = 2 seconds underwater — enough to confirm it's not a brief crossing.
      const headBlock = bot.blockAt(currentPos.offset(0, 1.6, 0).floor());
      if (headBlock && (headBlock.name === "water" || headBlock.name === "flowing_water")) {
        underwaterTicks++;
        if (underwaterTicks >= 4) {
          console.error(`[MoveTo] DROWNING RISK: Head underwater for ${underwaterTicks} checks at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Aborting navigation.`);
          bot.pathfinder.stop();
          bot.clearControlStates();
          // Try to swim up
          bot.setControlState("jump", true);
          finish({
            success: false,
            message: `Navigation stopped: underwater at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Drowning risk. Swim up (jump) and navigate on the surface.`,
            stuckReason: "underwater"
          });
          return;
        }
      } else {
        underwaterTicks = 0;
      }

      // SAFETY: Track maximum height reached during pathfinding
      // If bot goes much higher than start or target, pathfinder may be taking unsafe route.
      // Bot3 Death #4: pathfinder routed to Y=112 when going from Y=9 to Y=64, then fell.
      // Abort if bot climbs more than 15 blocks above BOTH start and target — this means
      // the pathfinder is taking a dangerous high-altitude route that risks a lethal fall.
      if (currentPos.y > maxHeightReached) {
        maxHeightReached = currentPos.y;
        const heightAboveStart = currentPos.y - start.y;
        const heightAboveTarget = currentPos.y - y;
        if (heightAboveStart > 15 && heightAboveTarget > 15) {
          console.error(`[MoveTo] DANGEROUS HIGH ROUTE: Bot climbed ${heightAboveStart.toFixed(1)} blocks above start and ${heightAboveTarget.toFixed(1)} above target (Y=${start.y.toFixed(1)} → Y=${currentPos.y.toFixed(1)}, target Y=${y.toFixed(1)}). Aborting to prevent fall death.`);
          finish({
            success: false,
            message: `Navigation stopped: pathfinder climbed too high (Y=${currentPos.y.toFixed(0)}, start Y=${start.y.toFixed(0)}, target Y=${y.toFixed(0)}). High-altitude route risks lethal fall. Try shorter segments or a different waypoint.`,
            stuckReason: "high_route"
          });
          return;
        }
        if (heightAboveStart > 8) {
          console.error(`[MoveTo] WARNING: Bot climbing too high (${heightAboveStart.toFixed(1)} blocks above start). May take dangerous falling route.`);
        }
      }

      // SAFETY: Detect underground cave routing — abort if bot descends far below expected path.
      // Case 1: Target is at/above start — bot should NOT descend more than 3 blocks below start.
      //   Reduced from 5 to 3: Bot1 Sessions 42-44, Bot3 #17,#19: bots descended 5+ blocks
      //   into caves before the old threshold caught it, by which point they were surrounded
      //   by underground mobs. 3 blocks allows natural terrain variation (hills, ravine edges)
      //   but catches cave entries much earlier, limiting underground exposure.
      // Case 2: Target is below start — bot should NOT descend more than 10 blocks below target Y.
      //   The pathfinder may legitimately descend when target is lower, but it should converge
      //   toward target Y, not dive far below it through cave systems.
      // Bot1 Session 44: navigated to (100,96,0) from surface, ended at Y=72 in cave, drowned.
      // Bot3 Death #11: navigated to farm, fell into ravine via pathfinder digging.
      // Bot3 Death #4: navigated from Y=9 to Y=64, pathfinder went to Y=112 then fell.
      const yDescentFromStart = start.y - currentPos.y;
      const targetIsAtOrAboveStart = y >= start.y - 5; // target within 5 blocks below start is "surface-level"
      if (targetIsAtOrAboveStart && yDescentFromStart > 3) {
        console.error(`[MoveTo] UNDERGROUND ROUTING DETECTED: Bot descended ${yDescentFromStart.toFixed(1)} blocks below start (Y=${start.y.toFixed(1)} → Y=${currentPos.y.toFixed(1)}) while target Y=${y.toFixed(1)} is at/above start. Pathfinder is routing through caves. Aborting.`);
        finish({
          success: false,
          message: `Navigation stopped: pathfinder routed underground (Y=${start.y.toFixed(0)} → Y=${currentPos.y.toFixed(0)}, target Y=${y.toFixed(0)}). Bot was descending into cave system. Try navigating in shorter segments or to a different waypoint.`,
          stuckReason: "underground_routing"
        });
        return;
      }
      // Case 2: target is significantly below start — allow descent but catch cave routing.
      // Two sub-checks:
      //   2a) Absolute max descent from start: never allow more than 8 blocks below start.
      //       Bot1/Bot2 [2026-03-22]: target at Y=88, start at Y=97. Old 10-block-below-target
      //       threshold allowed bot to reach Y=78 (19 blocks below start!) before triggering.
      //       8 blocks below start catches cave entries early even when target is below.
      //   2b) Overshoot: bot should not go more than 5 blocks below target Y.
      //       Reduced from 10 to 5: when target is far below start, the bot may legitimately
      //       descend but should converge toward target, not dive 10+ blocks past it.
      if (!targetIsAtOrAboveStart) {
        // 2a: Absolute max descent from start
        if (yDescentFromStart > 8) {
          console.error(`[MoveTo] CAVE DESCENT DETECTED: Bot descended ${yDescentFromStart.toFixed(1)} blocks below start (Y=${start.y.toFixed(1)} → Y=${currentPos.y.toFixed(1)}, target Y=${y.toFixed(1)}). Aborting to prevent underground trapping.`);
          finish({
            success: false,
            message: `Navigation stopped: descended ${yDescentFromStart.toFixed(0)} blocks below start (Y=${start.y.toFixed(0)} → Y=${currentPos.y.toFixed(0)}, target Y=${y.toFixed(0)}). Pathfinder may be routing through caves. Try shorter segments or a different waypoint.`,
            stuckReason: "underground_routing"
          });
          return;
        }
        // 2b: Overshoot below target
        const yBelowTarget = y - currentPos.y; // positive if bot is below target
        if (yBelowTarget > 5) {
          console.error(`[MoveTo] CAVE OVERSHOOT DETECTED: Bot at Y=${currentPos.y.toFixed(1)} is ${yBelowTarget.toFixed(1)} blocks below target Y=${y.toFixed(1)} (started at Y=${start.y.toFixed(1)}). Pathfinder overshot into cave. Aborting.`);
          finish({
            success: false,
            message: `Navigation stopped: pathfinder descended too far below target (Y=${currentPos.y.toFixed(0)}, target Y=${y.toFixed(0)}). Cave routing detected. Try navigating in shorter segments.`,
            stuckReason: "underground_routing"
          });
          return;
        }
      }

      // SAFETY: Mid-navigation hostile mob detection — abort if HP is low and hostiles are closing in.
      // Bot1 Sessions 27-44: 20+ deaths from mobs attacking during pathfinder movement at night.
      // The pre-navigation REFUSED check in core-tools.ts only blocks when hostiles are already nearby,
      // but mobs spawn/approach DURING travel. Short-distance (<50 block) navigation has no segment checks.
      // This catches the gap: every 500ms, check for hostiles and abort when dangerous.
      //
      // Two checks:
      //   A) Creeper proximity (any time of day) — creepers one-shot unarmored players at close range.
      //      Bot1 Sessions 24,27,30,33: blown up by creeper during navigation.
      //   B) Night + low HP + hostiles — original check with armor-aware threshold.
      //      Unarmored bots take 4-5 damage per skeleton shot; HP<=10 is too late to abort.
      const navHp = bot.health ?? 20;
      const navTime = bot.time?.timeOfDay ?? 0;
      const navIsNight = navTime > 12541 || navTime < 100;

      // Check A: Creeper within 8 blocks at ANY time — emergency abort.
      // Creeper fuse is 1.5s, explosion radius ~3 blocks, deals up to 49 damage unarmored.
      {
        let creeperNearby = false;
        let creeperDist = Infinity;
        for (const entity of Object.values(bot.entities)) {
          if (!entity || !entity.position || entity === bot.entity) continue;
          const eName = entity.name?.toLowerCase() ?? "";
          if (eName === "creeper") {
            const eDist = entity.position.distanceTo(currentPos);
            if (eDist < 8) {
              creeperNearby = true;
              creeperDist = Math.min(creeperDist, eDist);
            }
          }
        }
        if (creeperNearby) {
          console.error(`[MoveTo] CREEPER DANGER: Creeper at ${creeperDist.toFixed(1)} blocks during navigation. HP=${navHp.toFixed(1)}. Aborting for mc_flee.`);
          finish({
            success: false,
            message: `Navigation aborted: CREEPER at ${creeperDist.toFixed(1)} blocks! HP=${Math.round(navHp*10)/10}. Position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_flee IMMEDIATELY — creeper explosion is lethal at close range.`,
            stuckReason: "creeper_danger"
          });
          return;
        }
      }

      // Check B: Hostile detection with armor-aware threshold (night AND daytime).
      // Armor check: count equipped armor pieces. Full iron armor reduces skeleton damage from 5→2.
      // Unarmored bots need higher HP threshold to survive hits during flee.
      {
        let armorCount = 0;
        for (const slotName of ["head", "torso", "legs", "feet"] as const) {
          const slot = bot.inventory.slots[bot.getEquipmentDestSlot(slotName)];
          if (slot && slot.name.includes("_")) armorCount++;
        }

        // Night: wider radius (16 blocks), higher HP threshold — mobs are dense and respawn.
        // Daytime: tighter radius (10 blocks), lower HP threshold — only pillagers, cave
        // zombies, and remnant mobs are dangerous. But they DO kill:
        // Bot1/Bot2 [2026-03-22]: multiple daytime deaths from pillagers and zombies during
        // active pathfinding. The pre-nav check in core-tools.ts only fires once at start,
        // but mobs approach DURING the pathfinder movement. This 500ms check catches them.
        const scanRadius = navIsNight ? 16 : 10;
        // Night HP thresholds (high — mobs are everywhere):
        //   Unarmored: 14, Partial: 12, Full: 10
        // Daytime HP thresholds (lower — fewer mobs, but still lethal when close):
        //   Unarmored: 10, Partial: 8, Full: 6
        const hpThreshold = navIsNight
          ? (armorCount <= 1 ? 14 : armorCount <= 3 ? 12 : 10)
          : (armorCount <= 1 ? 10 : armorCount <= 3 ? 8 : 6);

        if (navHp <= hpThreshold) {
          const nearHostiles: Array<{ name: string; dist: number }> = [];
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            const eDist = entity.position.distanceTo(currentPos);
            if (eDist > scanRadius) continue;
            const eName = entity.name?.toLowerCase() ?? "";
            if (isHostileMob(bot, eName)) {
              nearHostiles.push({ name: eName, dist: Math.round(eDist * 10) / 10 });
            }
          }
          if (nearHostiles.length > 0) {
            const closestThreat = nearHostiles.sort((a, b) => a.dist - b.dist)[0];
            const threatList = nearHostiles.slice(0, 3).map(h => `${h.name}(${h.dist}m)`).join(", ");
            const armorNote = armorCount === 0 ? " NO ARMOR — very vulnerable." : armorCount < 4 ? ` Partial armor (${armorCount}/4).` : "";
            const timeNote = navIsNight ? "at night" : "during daytime";
            console.error(`[MoveTo] HOSTILE DANGER (${timeNote}): HP=${navHp.toFixed(1)}, armor=${armorCount}/4, ${nearHostiles.length} hostile(s) nearby: ${threatList}. Aborting navigation.`);
            finish({
              success: false,
              message: `Navigation aborted: HP=${Math.round(navHp*10)/10} ${timeNote} with ${nearHostiles.length} hostile(s) nearby (${threatList}).${armorNote} Current position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_flee, build shelter, or wait for dawn.`,
              stuckReason: navIsNight ? "night_danger" : "daytime_danger"
            });
            return;
          }
        }
      }

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

    // SAFETY: Use physicsTick for instant fall detection (500ms interval is too slow)
    // Track BOTH per-tick drops (to catch sudden falls) AND cumulative fall distance
    // (to catch gradual acceleration off cliff edges where per-tick is small but total is huge).
    let lastPhysicsY = start.y;
    let fallStartY: number | null = null;  // Y when falling started (null = not falling)
    const onPhysicsTick = () => {
      if (resolved) return;
      const cy = bot.entity.position.y;
      const tickDrop = lastPhysicsY - cy;

      if (tickDrop > 0.05) {
        // Bot is descending this tick — track cumulative fall
        if (fallStartY === null) {
          fallStartY = lastPhysicsY;  // Mark where fall began
        }
        const totalFall = fallStartY - cy;

        // Stop immediately if cumulative fall exceeds 3 blocks (fall damage starts at 4 blocks).
        // Threshold raised from 2→3 to avoid false-positives on planned 2-block drops (maxDropDown=2).
        if (totalFall > 3) {
          console.error(`[MoveTo] PHYSICS FALL: ${totalFall.toFixed(1)} blocks cumulative (started at Y=${fallStartY.toFixed(1)}, now Y=${cy.toFixed(1)}). Emergency stop!`);
          bot.pathfinder.stop();
          bot.clearControlStates();
          finish({
            success: false,
            message: `Navigation stopped: fell ${totalFall.toFixed(1)} blocks at (${bot.entity.position.x.toFixed(1)}, ${cy.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}). Unsafe terrain — use mc_tunnel(direction="up") to climb safely.`,
            stuckReason: "fall_detected"
          });
          lastPhysicsY = cy;
          return;
        }
      } else {
        // Bot is not descending (ascending or level) — reset fall tracking
        fallStartY = null;
      }

      lastPhysicsY = cy;
    };
    bot.on("physicsTick", onPhysicsTick);
    cleanupCallbacks.push(() => bot.removeListener("physicsTick", onPhysicsTick));

    // SAFETY: Enforce safe movement settings immediately before setting goal.
    // Although bot-core.ts sets these at initialization, they can be silently overridden
    // by mineflayer-pathfinder internals or dimension-change handlers between calls.
    // Setting them here guarantees they are always active for this navigation call.
    if (bot.pathfinder.movements) {
      bot.pathfinder.movements.maxDropDown = 2; // Allow 2-block drops for rugged terrain (physics fall detector catches >3)
      bot.pathfinder.movements.allowFreeMotion = false; // Prevent cliff falls from skipped path nodes
      bot.pathfinder.movements.allow1by1towers = true; // Allow pillar up to reach higher terrain
      // Re-apply liquidCost every call — bot-core.ts sets it at init, but pathfinder
      // internals or dimension-change handlers can silently reset it. Without this,
      // pathfinder routes through rivers/water at Y=61-62, causing repeated drowned deaths.
      // Bot1 Sessions 31-34,40b,44: 6+ deaths from pathfinder choosing water-level routes.
      (bot.pathfinder.movements as any).liquidCost = 10000;

      // SAFETY: Disable canDig at night OR when HP is low to prevent cave routing.
      // Bot1 Sessions 42-44, Bot3 #17,#19: pathfinder with canDig=true digs through terrain,
      // opening cave systems where underground mobs surround the bot.
      // Night: hostile mobs fill caves densely. Disabling canDig forces surface routing.
      // Low HP: Bot1/Bot2/Bot3 [2026-03-22] multiple deaths from canDig cave entry at low HP
      // during daytime — any mob encounter at HP<10 is fatal. Disable canDig to keep bot
      // on the surface where it can flee/eat instead of getting trapped underground.
      const navTimeOfDay = bot.time?.timeOfDay ?? 0;
      const navIsNight = navTimeOfDay > 12541 || navTimeOfDay < 100;
      const navHp = bot.health ?? 20;
      if (navIsNight || navHp < 10) {
        bot.pathfinder.movements.canDig = false;
        const reason = navIsNight ? `night (time=${navTimeOfDay})` : `low HP (${navHp.toFixed(1)})`;
        console.error(`[MoveTo] canDig disabled to prevent cave routing: ${reason}`);
      } else {
        bot.pathfinder.movements.canDig = true;
      }
      // Enable scaffolding with available blocks (dirt, cobblestone, netherrack)
      const scaffoldBlocks: number[] = [];
      const mcData = (bot as any).registry || require("minecraft-data")(bot.version);
      for (const name of ["dirt", "cobblestone", "netherrack", "cobbled_deepslate"]) {
        const block = mcData.blocksByName[name];
        if (block) scaffoldBlocks.push(block.id);
      }
      if (scaffoldBlocks.length > 0) {
        bot.pathfinder.movements.scafoldingBlocks = scaffoldBlocks;
      }
      // Note: canPlaceOn is not a valid Movements property; scaffolding + allow1by1towers handles bridging
    }

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

  // SAFETY CHECK: Prevent dangerous long-distance movement when HP is critically low
  // Only block movement when HP is dangerously low AND distance is far (high-altitude route risk).
  // Short-distance moves (≤30 blocks) are always allowed so bot can reach food/chests.
  // Previous threshold (hp<5 && dist>8) caused deadlocks where bots couldn't reach nearby food.
  // Daytime check: if it's daytime (ticks < 12541) and no hostile threats, allow movement at HP≥2
  // to prevent starvation deadlock (HP=2, no food, can't move to find food).
  // In Nether/End dimensions, timeOfDay is always 0 — treat as "safe" (no day/night cycle).
  const hp = bot.health ?? 20;
  const timeOfDay = (bot.time?.timeOfDay ?? 0) as number;
  const currentDimension = String(bot.game?.dimension ?? "overworld");
  const isNetherOrEnd = currentDimension.includes("nether") || currentDimension.includes("end");
  // In Nether/End: treat as daytime (no night cycle). In OW: check actual time.
  const isDaytime = isNetherOrEnd || timeOfDay < 12541;
  const hasHostileNearby = Object.values(bot.entities).some((e: any) => {
    if (!e || !e.position) return false;
    const dist = e.position.distanceTo(bot.entity.position);
    return dist < 20 && e.type === "mob" && (e.name === "creeper" || e.name === "skeleton" || e.name === "zombie" || e.name === "spider" || e.name === "enderman" || e.name === "witch");
  });

  // Auto-eat if food available and HP is low — prevents navigating into death
  // Bug fix (bot1.md 2026-03-16): Bot had HP=4.5, food=16 but skipped eating because hunger check passed.
  // Now: if HP < 14 AND food items in inventory, eat before moving long distances.
  if (hp < 14 && distance > 30) {
    const foodItems = bot.inventory.items().filter((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
    if (foodItems.length > 0) {
      console.error(`[Move] HP=${hp.toFixed(1)}, eating ${foodItems[0].name} before ${distance.toFixed(1)}-block move...`);
      try {
        await bot.equip(foodItems[0], "hand");
        await bot.consume();
        console.error(`[Move] Ate ${foodItems[0].name}, HP now: ${bot.health?.toFixed(1)}`);
      } catch (_) {
        // continue even if eat fails
      }
    }
  }

  // Auto-equip armor at night before any movement — prevents deaths during
  // mc_gather, mc_navigate, and any other tool that calls moveTo internally.
  // Bot1 Sessions 35-45: 10+ deaths from navigating at night without armor.
  // Bot2: skeleton shot during mc_farm/mc_gather with no armor.
  // mc_navigate already auto-equips, but mc_gather and other callers skip it.
  // Adding here ensures ALL movement at night has armor protection.
  if (!isDaytime) {
    try {
      await equipArmor(bot);
    } catch (_) {
      // Continue without armor — better than not moving
    }
  }

  // Re-read HP after eating
  const hpNow = bot.health ?? 20;

  // PRE-CHECK: If target block is a portal, skip HP/distance safety checks.
  // Portal navigation teleports the bot — no fall risk. Blocking portal entry at low HP
  // causes permanent deadlock (can't heal without food, can't get food without entering Nether).
  const targetBlockPreCheck = bot.blockAt(targetPos);
  const isTargetPortal = targetBlockPreCheck &&
    (targetBlockPreCheck.name === "nether_portal" || targetBlockPreCheck.name === "end_portal");
  if (!isTargetPortal) {
    // Starvation deadlock exception (bot1.md 2026-03-18):
    // If hunger=0 AND no food in inventory AND no hostile mobs nearby, allow movement at HP≥2.
    // Rationale: staying put guarantees death (starvation + no recovery); moving to find food is the only path.
    const hungerLevel = (bot as any).food ?? 20;
    const hasFoodInInventory = bot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
    const isStarvationDeadlock = hungerLevel === 0 && !hasFoodInInventory && !hasHostileNearby;

    // During daytime with no hostile mobs nearby, allow movement at HP≥2 (starvation deadlock prevention)
    // At night or with hostile mobs nearby, use strict HP check to prevent fall death
    if (isDaytime && !hasHostileNearby) {
      // Daytime safe: only block if truly near-death (hp < 2, i.e. 1 heart)
      if (hpNow < 2 && distance > 30) {
        return `⚠️ SAFETY: Cannot move ${distance.toFixed(1)} blocks with critical HP(${hpNow.toFixed(1)}/20). Risk of high-altitude pathfinding causing fall death. Eat food or heal first, then retry movement.`;
      }
    } else if (isStarvationDeadlock) {
      // Starvation deadlock: hunger=0, no food, no hostiles. Allow movement at HP≥2.
      // Moving to find food is the only survival option.
      console.error(`[Move] Starvation deadlock detected (hunger=0, no food, no hostiles). Allowing movement at HP=${hpNow.toFixed(1)}.`);
      if (hpNow < 2 && distance > 30) {
        return `⚠️ SAFETY: Cannot move ${distance.toFixed(1)} blocks with critical HP(${hpNow.toFixed(1)}/20). HP too low even for starvation escape. Use /give or seek shelter.`;
      }
    } else if (!hasFoodInInventory) {
      // No food + nighttime/hostile: deadlock prevention.
      // Without food, HP cannot recover — blocking movement guarantees death.
      // Allow movement at HP≥2 so bot can reach food sources.
      console.error(`[Move] No food + night/hostile. Allowing movement at HP=${hpNow.toFixed(1)} to prevent deadlock.`);
      if (hpNow < 2 && distance > 30) {
        return `⚠️ SAFETY: Cannot move ${distance.toFixed(1)} blocks with critical HP(${hpNow.toFixed(1)}/20). HP too low even for food search.`;
      }
    } else {
      // Nighttime or hostile nearby WITH food available: block movement when HP is dangerously low
      // Bot can eat to recover, so blocking is safe — prevents fall death under mob pressure.
      if (hpNow < 8 && distance > 30) {
        return `⚠️ SAFETY: Cannot move ${distance.toFixed(1)} blocks with critical HP(${hpNow.toFixed(1)}/20) at night/hostile nearby. Risk of fall death under mob pressure. Eat food or heal first, then retry movement.`;
      }
    }
    if (hpNow < 10 && distance > 30) {
      console.error(`[Move] WARNING: Moving ${distance.toFixed(1)} blocks with low HP(${hpNow.toFixed(1)}/20). Proceeding with caution.`);
    }
  } else {
    console.error(`[Move] Target is a portal block — bypassing HP/distance safety checks for portal entry.`);
  }

  // Check if target position is a portal block — delegate to enterPortal()
  // Only if the portal would take us to a DIFFERENT dimension (avoid infinite loop in same dimension)
  const targetBlock = bot.blockAt(targetPos);
  if (targetBlock && (targetBlock.name === "nether_portal" || targetBlock.name === "end_portal")) {
    const currentDim = String(bot.game.dimension);
    const isEndPortal = targetBlock.name === "end_portal";
    const isNetherPortal = targetBlock.name === "nether_portal";
    const alreadyInEnd = currentDim.includes("end");
    // nether_portal is bidirectional: OW->Nether and Nether->OW. Never skip.
    // end_portal in End dimension: skip to avoid infinite loop (End exit portal handled separately).
    // Only skip end_portal if already in End (avoid re-entering exit portal loop).
    const shouldSkip = (isEndPortal && alreadyInEnd);
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
      // Bug fix (Session 186): If a standable candidate attempt caused a fall,
      // do NOT try more candidates - the bot's position has changed due to falling
      // and further candidate attempts will cause compounding fall damage.
      if (result.stuckReason === "fall_detected" || result.stuckReason === "lava_detected") {
        console.error(`[Move] Stopping candidate search: ${result.stuckReason} during standable position attempt.`);
        break;
      }
    }

    // No standable candidate found or all failed - fall through to pathfinder
    // Pathfinder with canDig may be able to dig its way there
    console.error(`[Move] No standable candidate succeeded, falling through to pathfinder for (${x}, ${y}, ${z})`);
  }

  // SAFETY CHECK: Verify ground exists at destination
  const groundCheck = checkGroundBelow(bot, x, y, z, 10);
  if (!groundCheck.safe) {
    if (groundCheck.hasLavaBelow) {
      // Bug fix (Session 186): lava below destination is ALWAYS lethal — abort regardless of HP.
      // The pathfinder routes over lava lakes in the Nether, causing direct lava deaths even at HP=20.
      console.error(`[Move] BLOCKED: Destination (${x}, ${y}, ${z}) has lava ${groundCheck.fallDistance} blocks below. Aborting to prevent lava death.`);
      return `⚠️ SAFETY: Destination (${x}, ${y}, ${z}) has lava ${groundCheck.fallDistance} blocks below. Route over lava lake is lethal. Choose a different waypoint.`;
    }
    if (groundCheck.fallDistance >= 10) {
      console.error(`[Move] WARNING: No solid ground at destination (${x}, ${y}, ${z}), fall distance: ${groundCheck.fallDistance} blocks`);
      // Only block if HP is truly critical (< 3) AND fall would be lethal.
      // Previously blocked at hp < 10, but this prevented pathfinder from routing around the gap,
      // causing permanent deadlock in Nether navigation (bot stuck at portal spawn unable to move).
      // Bug fix: pathfinder can navigate around 10-block falls; only block when survival is impossible.
      if (hpNow < 3) {
        return `⚠️ SAFETY: Destination (${x}, ${y}, ${z}) has no ground within ${groundCheck.fallDistance} blocks below. Fall would be lethal at HP=${hpNow.toFixed(1)}/20. Aborting movement.`;
      }
    }
  }

  // SAFETY CHECK: If target is significantly lower, prevent fall damage
  // Pathfinder handles moderate height changes with digging/towers (maxDropDown=1, enforced in moveToBasic)
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

    // Skip non-solid/dangerous blocks: air, water, lava, fire, void
    const dangerousBlocks = ["air", "cave_air", "water", "lava", "fire", "soul_fire", "void_air"];
    if (block && !dangerousBlocks.includes(block.name)) {
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

  // Keep sneak ON throughout the entire pillar to prevent drifting off the edge.
  // Bug #17: releasing sneak between placements caused the bot to walk off the 1-block pillar
  // in caves with irregular terrain, leading to "Placement failed" on the next iteration.
  bot.setControlState("sneak", true);

  // Lock the pillar column (X, Z) to the initial block position.
  // Bot1 bug: after each jump-place cycle, the bot drifts slightly (0.1-0.3 blocks),
  // causing Math.floor to snap to an adjacent column on later iterations.
  // This made blockBelow lookup fail ("Placement failed" after 1 block).
  // By locking the column, all iterations place on the same X/Z pillar.
  const pillarX = Math.floor(bot.entity.position.x);
  const pillarZ = Math.floor(bot.entity.position.z);

  for (let i = 0; i < targetHeight; i++) {
    // Use locked pillar column for X/Z, only Y changes
    const curX = pillarX;
    const currentY = Math.floor(bot.entity.position.y);
    const curZ = pillarZ;

    // Re-center bot on the pillar column center before each jump.
    // Bot1 bug: position drifts 0.1-0.3 blocks per jump cycle, eventually leaving
    // the pillar column entirely. lookAt the block center to nudge the bot back.
    const pillarCenterX = pillarX + 0.5;
    const pillarCenterZ = pillarZ + 0.5;
    const driftX = Math.abs(bot.entity.position.x - pillarCenterX);
    const driftZ = Math.abs(bot.entity.position.z - pillarCenterZ);
    if (driftX > 0.3 || driftZ > 0.3) {
      console.error(`[Pillar] Re-centering: drift=(${driftX.toFixed(2)}, ${driftZ.toFixed(2)})`);
      // Look straight down at pillar center to nudge position back
      try {
        await bot.lookAt(new Vec3(pillarCenterX, bot.entity.position.y - 1, pillarCenterZ));
        // Brief forward walk while sneaking to re-center
        bot.setControlState("forward", true);
        await new Promise(r => setTimeout(r, 150));
        bot.setControlState("forward", false);
        await new Promise(r => setTimeout(r, 200));
      } catch (_) { /* ignore */ }
    }

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

    // SAFETY: Abort if water is at or above head level — drowning risk.
    // Bot3 Death #6: drowned during pillar_up because water blocks flooded the column.
    // Check Y+1 (head) and Y+2 (above head) for water. If either is water, stop.
    for (const yOff of [1, 2]) {
      const waterCheck = bot.blockAt(new Vec3(curX, currentY + yOff, curZ));
      if (waterCheck && (waterCheck.name === "water" || waterCheck.name === "flowing_water")) {
        console.error(`[Pillar] WATER at Y=${currentY + yOff} (${waterCheck.name}). Aborting to prevent drowning.`);
        bot.setControlState("sneak", false);
        return `Pillared up ${(bot.entity.position.y - startY).toFixed(1)} blocks (placed ${blocksPlaced}/${targetHeight}). STOPPED: Water detected at Y=${currentY + yOff} — drowning risk. Move away from water first.${getBriefStatus(managed)}`;
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
          // Only stop forward/back/left/right movement, but KEEP sneak ON.
          // Bug #17: bot.clearControlStates() released sneak, causing drift off the 1-block pillar
          // in caves, leading to "Placement failed" on subsequent iterations.
          bot.setControlState("forward", false);
          bot.setControlState("back", false);
          bot.setControlState("left", false);
          bot.setControlState("right", false);
          bot.setControlState("jump", false);
          bot.setControlState("sprint", false);
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
    // Use the locked pillar column as primary candidate — this is where we've been
    // placing blocks. Fall back to actual position if pillar column is air.
    const feetY = Math.floor(bot.entity.position.y);
    const bx = Math.floor(bot.entity.position.x);
    const bz = Math.floor(bot.entity.position.z);
    const candidates = [
      new Vec3(pillarX, feetY - 1, pillarZ),  // Pillar column (most reliable)
      new Vec3(bx, feetY - 1, bz),            // Actual position
      new Vec3(pillarX, feetY - 2, pillarZ),   // Pillar column -2
      new Vec3(bx, feetY - 2, bz),            // Actual position -2
    ];
    let blockBelow: ReturnType<typeof bot.blockAt> = null;
    console.error(`[Pillar] Looking for block below: pos=(${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)}), feetY=${feetY}, bx=${bx}, bz=${bz}, curX=${curX}, curZ=${curZ}`);
    for (const pos of candidates) {
      const b = bot.blockAt(pos);
      console.error(`[Pillar]   candidate (${pos.x},${pos.y},${pos.z}): ${b?.name ?? "null"} bb=${(b as any)?.boundingBox ?? "?"}`);
      if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "water" && b.name !== "void_air") {
        blockBelow = b;
        break;
      }
    }
    if (!blockBelow) {
      console.error(`[Pillar] No block below to place against at Y=${feetY - 1}. All candidates were air/water/null.`);
      break;
    }

    // 4. Jump and place - retry up to 3 times per level
    // KEY FIX: Look straight down BEFORE jumping, not during the fall.
    // The old approach: jump → wait for peak → lookAt (async, adds latency) → placeBlock
    // By the time lookAt + placeBlock executed, the bot had already fallen past the placement point.
    // New approach: lookAt down ONCE before jump → jump → place immediately at rise > 0.5 (no re-lookAt)
    let placed = false;
    for (let attempt = 0; attempt < 3 && !placed; attempt++) {
      // Re-center on the block before each attempt — stop movement but KEEP sneak.
      bot.setControlState("forward", false);
      bot.setControlState("back", false);
      bot.setControlState("left", false);
      bot.setControlState("right", false);
      bot.setControlState("jump", false);
      bot.setControlState("sprint", false);
      await new Promise(r => setTimeout(r, 150));

      // Re-fetch blockBelow in case position shifted
      if (attempt > 0) {
        const retryFeetY = Math.floor(bot.entity.position.y);
        const retryX = Math.floor(bot.entity.position.x);
        const retryZ = Math.floor(bot.entity.position.z);
        const retryCandidates = [
          new Vec3(pillarX, retryFeetY - 1, pillarZ),
          new Vec3(retryX, retryFeetY - 1, retryZ),
          new Vec3(pillarX, retryFeetY, pillarZ),
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

      // CRITICAL: Look straight down at the block we're standing on BEFORE jumping.
      // This is the scaffolding technique: look at the block under your feet, jump, place.
      // By looking down before the jump, we avoid the async lookAt latency during the fall.
      const preJumpBlock = blockBelow!;
      const lookTarget = preJumpBlock.position.offset(0.5, 1, 0.5);
      await bot.lookAt(lookTarget, true);
      // Set pitch to look straight down for maximum reliability
      await bot.look(bot.entity.yaw, -Math.PI / 2, true);
      await new Promise(r => setTimeout(r, 100)); // Brief settle after look

      // Save reference block position before jumping
      const savedBlockPos = preJumpBlock.position.clone();

      const jumpBaseY = bot.entity.position.y;
      bot.setControlState("jump", true);

      // Wait until we've risen enough (>= 0.5 blocks). Don't wait for peak — place while
      // still rising gives us more time before we fall past the placement point.
      // The bot is already looking down, so no lookAt needed during the jump.
      let jumpOk = false;
      await new Promise<void>((resolve) => {
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 10;
          const rising = bot.entity.position.y - jumpBaseY;
          // Place as soon as we've risen enough (while still going up or at peak)
          if (rising >= 0.5) {
            jumpOk = true;
            clearInterval(interval);
            resolve();
          } else if (elapsed >= 600) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      });

      bot.setControlState("jump", false);

      // Place immediately — no lookAt here, we already looked down before the jump
      if (jumpOk) {
        try {
          // Re-fetch the block at saved position for a fresh reference.
          let freshBlock = bot.blockAt(savedBlockPos);
          if (!freshBlock || freshBlock.name === "air" || freshBlock.name === "cave_air") {
            // Fallback: search below current position
            const curJumpPos = bot.entity.position;
            const belowCandidates = [
              new Vec3(pillarX, Math.floor(curJumpPos.y) - 1, pillarZ),
              new Vec3(Math.floor(curJumpPos.x), Math.floor(curJumpPos.y) - 1, Math.floor(curJumpPos.z)),
              new Vec3(pillarX, Math.floor(curJumpPos.y), pillarZ),
              new Vec3(Math.floor(curJumpPos.x), Math.floor(curJumpPos.y), Math.floor(curJumpPos.z)),
            ];
            for (const bp of belowCandidates) {
              const candidate = bot.blockAt(bp);
              if (candidate && candidate.name !== "air" && candidate.name !== "cave_air" && candidate.name !== "void_air") {
                freshBlock = candidate;
                console.error(`[Pillar] Used fallback block: ${candidate.name} at (${bp.x},${bp.y},${bp.z})`);
                break;
              }
            }
          }
          if (!freshBlock) freshBlock = blockBelow;

          // Place on top of block below (this puts block at feet level, lifting us up)
          // CRITICAL FIX: Use _placeBlockWithOptions with forceLook:'ignore'.
          // bot.placeBlock() internally calls lookAt() on the reference block face,
          // which is async and adds ~50-100ms of latency. During that time the bot
          // falls past the placement point, causing the server to reject the placement.
          // We already looked straight down before jumping (line 1316), so skip the
          // redundant lookAt inside placeBlock to place immediately while still airborne.
          await (bot as any)._placeBlockWithOptions(freshBlock!, new Vec3(0, 1, 0), { forceLook: 'ignore', swingArm: 'right' });
          blocksPlaced++;
          placed = true;
          console.error(`[Pillar] Placed ${blocksPlaced}/${targetHeight} at Y=${currentY}`);
        } catch (e) {
          console.error(`[Pillar] Place failed (attempt ${attempt + 1}): ${e}`);
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        console.error(`[Pillar] Jump too low (${(bot.entity.position.y - jumpBaseY).toFixed(2)}), retrying...`);
        await new Promise(r => setTimeout(r, 300));
      }

      // Wait to land on the new block (sneak stays on to prevent drift)
      await new Promise(r => setTimeout(r, 500));
    }

    if (!placed) {
      console.error(`[Pillar] Failed to place block after 3 attempts at level ${i + 1}`);
      break;
    }
  }

  // Release sneak after pillar is complete
  bot.setControlState("sneak", false);
  await new Promise(r => setTimeout(r, 200));

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
    // Find ALL nearby hostiles (using dynamic registry check), sorted by distance.
    // Bot2 bug: flee only considered nearest hostile, running into other mobs when surrounded.
    // Now we compute a weighted flee direction away from ALL hostiles within 24 blocks.
    const allHostiles = Object.values(bot.entities)
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .map(e => ({
        entity: e,
        dist: e.position.distanceTo(bot.entity.position),
        name: e.name || "hostile"
      }))
      .filter(h => h.dist <= 24)
      .sort((a, b) => a.dist - b.dist);

    const hostile = allHostiles[0]?.entity;

    // Calculate flee direction
    let direction: { x: number; y: number; z: number; scaled: (n: number) => any };
    let fleeFromName: string;

    if (allHostiles.length > 0) {
      // Flee away from ALL hostiles — weighted by inverse distance (closer = stronger repulsion).
      // Bot2 [2026-03-22]: 7 mobs surrounded bot, flee from nearest ran into others.
      // Using weighted centroid ensures flee direction avoids the densest cluster of hostiles.
      let sumX = 0, sumZ = 0, totalWeight = 0;
      for (const h of allHostiles) {
        // Weight: closer mobs have much more influence (inverse square distance)
        const weight = 1 / Math.max(h.dist * h.dist, 1);
        const away = bot.entity.position.minus(h.entity.position);
        sumX += away.x * weight;
        sumZ += away.z * weight;
        totalWeight += weight;
      }
      // Normalize to get average flee direction — HORIZONTAL ONLY.
      // Bot2 bug: hostile at Y=100, bot at Y=80 → direction.y was negative → flee target
      // pointed underground → pathfinder routed into cave at Y=56.
      // Zeroing Y ensures flee stays on the same elevation, preventing cave/hole routing.
      const avgX = totalWeight > 0 ? sumX / totalWeight : 0;
      const avgZ = totalWeight > 0 ? sumZ / totalWeight : 0;
      const horizontal = new (bot.entity.position as any).constructor(avgX, 0, avgZ);
      // If horizontal distance is zero (all hostiles directly above/below), pick random horizontal direction
      if (horizontal.norm() < 0.1) {
        const angle = Math.random() * 2 * Math.PI;
        direction = new (bot.entity.position as any).constructor(Math.cos(angle), 0, Math.sin(angle));
      } else {
        direction = horizontal.normalize();
      }
      fleeFromName = allHostiles.length === 1
        ? allHostiles[0].name
        : `${allHostiles.length} hostiles (${allHostiles.slice(0, 3).map(h => h.name).join(", ")})`;
      console.error(`[Flee] Fleeing from ${fleeFromName} — weighted direction from ${allHostiles.length} hostile(s)`);
    } else {
      // No hostile found - flee in a random direction
      const angle = Math.random() * 2 * Math.PI;
      const vec = new (bot.entity.position as any).constructor(Math.cos(angle), 0, Math.sin(angle));
      direction = vec.normalize();
      fleeFromName = "danger";
      console.error(`[Flee] No hostile found, fleeing in random direction`);
    }

    // Flee target at same Y level as bot — never target underground positions
    const fleeTarget = bot.entity.position.plus(direction.scaled(distance));
    const startPos = bot.entity.position.clone();

    // SAFETY: Limit drop-downs and penalize liquid during flee.
    // maxDropDown=1 allows safe 1-block drops (no fall damage) while preventing cliff falls.
    // Previous maxDropDown=0 was TOO restrictive: on hilly terrain (old_growth_birch_forest),
    // the pathfinder couldn't navigate at all because nearly every path involves a 1-block drop.
    // Bot3 #26: fled only 7.2 blocks because maxDropDown=0 blocked all downhill movement.
    // liquidCost=10000 prevents water routing (drowning).
    const prevMaxDropDown = bot.pathfinder.movements?.maxDropDown ?? 1;
    const prevLiquidCost = (bot.pathfinder.movements as any)?.liquidCost ?? 100;
    const prevAllowSprinting = bot.pathfinder.movements?.allowSprinting ?? true;
    const prevCanDig = bot.pathfinder.movements?.canDig ?? true;
    if (bot.pathfinder.movements) {
      bot.pathfinder.movements.maxDropDown = 1;
      (bot.pathfinder.movements as any).liquidCost = 10000;
      // Enable sprinting during flee — this is an emergency escape, speed is critical.
      // Bot3 #26: fled only 7.2 blocks in 8s without sprint. Sprinting doubles speed.
      bot.pathfinder.movements.allowSprinting = true;
      // SAFETY: Disable canDig during flee — fleeing should NEVER dig into terrain.
      // Bot2 [2026-03-22]: mc_flee with canDig=true dug through surface, bot fell from
      // Y=80 to Y=56 into a cave system and was trapped underground with 9 mobs.
      // Flee uses setGoal() directly (bypasses moveToBasic safety checks), so canDig
      // cave prevention from moveToBasic doesn't apply. Must disable explicitly here.
      bot.pathfinder.movements.canDig = false;
    }

    const goal = new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3);
    bot.pathfinder.setGoal(goal);

    // Scale timeout with requested distance. Base 10s + 0.4s per block beyond 20.
    // Bot3 #26: 8s timeout was too short for 30-50 block flee on rough terrain.
    // Cap raised to 30s: even with maxDropDown=1 (improved from 0), pathfinder still
    // takes longer on hilly terrain with direction retries. 20s was insufficient.
    const fleeTimeoutMs = Math.min(Math.max(10000, 10000 + (distance - 20) * 400), 30000);

    // Wait for movement with proper completion check
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try { bot.pathfinder.setGoal(null); } catch { /* bot may have disconnected */ }
        resolve();
      }, fleeTimeoutMs);

      const fleeStartTime = Date.now();
      let retryCount = 0; // Track how many direction retries we've done
      const maxRetries = 3; // Try up to 3 alternate directions (90°, 180°, 270°)
      const check = setInterval(() => {
        try {
          const distMoved = bot.entity.position.distanceTo(startPos);
          const elapsed = Date.now() - fleeStartTime;

          // SAFETY: Real-time Y-descent detection during flee.
          // Flee uses setGoal() directly, bypassing moveToBasic's underground routing
          // and fall detection. Without this check, the bot can descend into caves/holes
          // during flee with no abort mechanism until post-flee warning (too late).
          // Bot2 [2026-03-22]: fled from Y=80 to Y=56 (24 blocks down) into cave.
          // Threshold: 4 blocks below start Y — allows natural 1-3 block terrain drops
          // but catches cave entries before bot gets trapped deep underground.
          const yDescent = startPos.y - bot.entity.position.y;
          if (yDescent > 4) {
            console.error(`[Flee] CAVE DESCENT ABORT: Bot dropped ${yDescent.toFixed(1)} blocks during flee (Y=${startPos.y.toFixed(0)}→${bot.entity.position.y.toFixed(0)}). Stopping to prevent underground trapping.`);
            clearInterval(check);
            clearTimeout(timeout);
            try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
            resolve();
            return;
          }

          // Success: moved enough distance. Lowered from 0.7 to 0.5 — on constrained
          // terrain, achieving 50% of target distance is often sufficient to escape.
          // Waiting for 70% caused unnecessary timeout when 60% was already safe.
          if (distMoved >= distance * 0.5) {
            clearInterval(check);
            clearTimeout(timeout);
            try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
            resolve();
            return;
          }

          // Only check isMoving() after minimum 2s to prevent premature exit.
          // Pathfinder may briefly report isMoving()=false during path recalculation,
          // especially with maxDropDown=0 on rough terrain. Give it time to find a path.
          if (elapsed > 2000 && !bot.pathfinder.isMoving()) {
            // Pathfinder gave up — try alternate flee directions.
            // Bot3 #26: single perpendicular retry was insufficient when surrounded.
            // Try 90°, 180°, 270° rotations from original direction.
            if (retryCount < maxRetries && elapsed < fleeTimeoutMs - 2000) {
              retryCount++;
              const curPos = bot.entity.position;
              // Rotate by 90° * retryCount from the ORIGINAL flee direction
              const baseAngle = Math.atan2(fleeTarget.z - startPos.z, fleeTarget.x - startPos.x);
              const rotAngle = baseAngle + (Math.PI / 2) * retryCount;
              const retryTarget = curPos.offset(Math.cos(rotAngle) * distance, 0, Math.sin(rotAngle) * distance);
              const retryGoal = new goals.GoalNear(retryTarget.x, retryTarget.y, retryTarget.z, 3);
              console.error(`[Flee] Retry #${retryCount}: rotating ${90 * retryCount}° from original direction (moved ${distMoved.toFixed(1)} blocks so far)`);
              try { bot.pathfinder.setGoal(retryGoal); } catch { /* ignore */ }
            } else {
              clearInterval(check);
              clearTimeout(timeout);
              try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
              resolve();
            }
          }
        } catch {
          // Bot entity may be invalid if disconnected during flee
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 200);
    });

    // Restore previous pathfinder settings after flee completes
    if (bot.pathfinder.movements) {
      bot.pathfinder.movements.allowSprinting = prevAllowSprinting;
      bot.pathfinder.movements.maxDropDown = prevMaxDropDown;
      (bot.pathfinder.movements as any).liquidCost = prevLiquidCost;
      bot.pathfinder.movements.canDig = prevCanDig;
    }

    // Post-flee safety: detect if bot fell into a cave or hole during flee.
    // Bot2 bug: mc_flee dropped bot from Y=80 to Y=56 (cave hole), trapped underground.
    // Even with maxDropDown=0, the bot can end up lower if terrain crumbles or pathing
    // glitches near cave openings. Warn the caller so they can take corrective action.
    const endPos = bot.entity.position;
    const yDescent = startPos.y - endPos.y;
    let caveWarning = "";
    if (yDescent > 5) {
      console.error(`[Flee] WARNING: Bot descended ${yDescent.toFixed(1)} blocks during flee (Y=${startPos.y.toFixed(1)} → Y=${endPos.y.toFixed(1)}). May be trapped underground.`);
      caveWarning = ` [WARNING] Fell ${yDescent.toFixed(0)} blocks during flee (Y=${startPos.y.toFixed(0)}→${endPos.y.toFixed(0)}). May be underground — use minecraft_pillar_up or mc_navigate to return to surface.`;
    }

    // Post-flee auto-eat: after fleeing, HP is often critically low from the attack
    // that triggered the flee. Without eating immediately, the next mob encounter
    // or starvation tick kills the bot before the agent can react.
    // Bot1 Sessions 23,24,28,30: fled with HP<8, died to next mob before agent could mc_eat.
    // Bot2: fled with HP 3.3, immediately surrounded again and died.
    const postFleeHp = bot.health ?? 20;
    if (postFleeHp < 14) {
      const foodItem = bot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      if (foodItem) {
        try {
          await bot.equip(foodItem, "hand");
          await bot.consume();
          console.error(`[Flee] Post-flee auto-ate ${foodItem.name} (HP: ${postFleeHp.toFixed(1)} → ${bot.health?.toFixed(1)})`);
        } catch (_) { /* ignore eat errors */ }
      }
    }

    const distMoved = bot.entity.position.distanceTo(startPos);
    if (hostile) {
      const newDist = bot.entity.position.distanceTo(hostile.position);
      return `Fled from ${fleeFromName}! Now ${newDist.toFixed(1)} blocks away. HP: ${(bot.health ?? 0).toFixed(1)}/20` + caveWarning;
    }
    return `Fled ${distMoved.toFixed(1)} blocks from ${fleeFromName}! HP: ${(bot.health ?? 0).toFixed(1)}/20` + caveWarning;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Flee] Error during flee: ${errMsg}`);
    // Stop all movement controls and restore pathfinder settings to prevent stuck state
    try {
      bot.clearControlStates();
      bot.pathfinder.setGoal(null);
      if (bot.pathfinder.movements) {
        bot.pathfinder.movements.maxDropDown = 2; // restore safe default (2-block max drop, physics fall detector catches >3)
        (bot.pathfinder.movements as any).liquidCost = 10000; // keep water avoidance
        bot.pathfinder.movements.allowSprinting = true; // restore default
        bot.pathfinder.movements.canDig = true; // restore default
      }
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
 * Dig a staircase upward — safe way to escape ravines/caves
 * Digs 2-high staircase pattern: dig above + ahead, place block below to step up, repeat.
 * Each step gains 1 Y level. Uses north direction for horizontal component.
 */
async function digStaircaseUp(managed: ManagedBot, height: number = 10): Promise<string> {
  const bot = managed.bot;
  const startPos = bot.entity.position.clone();
  const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

  // Stop all movement
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  try { bot.stopDigging(); } catch { /* ignore */ }
  await new Promise(r => setTimeout(r, 150));

  // Auto-equip best pickaxe
  const pickaxePriority = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe"];
  let equippedTool = "empty hand";
  for (const toolName of pickaxePriority) {
    const tool = bot.inventory.items().find(i => i.name === toolName);
    if (tool) {
      await bot.equip(tool, "hand");
      equippedTool = toolName;
      break;
    }
  }
  if (equippedTool === "empty hand") {
    throw new Error("Cannot dig staircase - no pickaxe! Craft one first.");
  }

  // Find scaffolding block (cobblestone, dirt, etc.) for step placement
  const scaffoldNames = ["cobblestone", "cobbled_deepslate", "dirt", "netherrack", "stone"];
  const getScaffoldItem = () => {
    for (const name of scaffoldNames) {
      const item = bot.inventory.items().find(i => i.name === name);
      if (item) return item;
    }
    return null;
  };

  let blocksClimbed = 0;
  const oresFound: Record<string, number> = {};

  // Use north as horizontal direction for staircase
  const hDir = { dx: 0, dz: -1 };

  console.error(`[Staircase] Starting upward staircase from (${Math.floor(startPos.x)}, ${Math.floor(startPos.y)}, ${Math.floor(startPos.z)}), height ${height}`);

  for (let i = 0; i < height; i++) {
    const curX = Math.floor(bot.entity.position.x);
    const curY = Math.floor(bot.entity.position.y);
    const curZ = Math.floor(bot.entity.position.z);

    // Step pattern: dig the block ahead at feet level, head level, and one above head
    // Then jump-place a block under feet to gain +1 Y
    const aheadX = curX + hDir.dx;
    const aheadZ = curZ + hDir.dz;

    // Dig blocks: ahead at Y+0, Y+1, Y+2 (feet, head, above head of next position)
    const blocksToDig = [
      { x: aheadX, y: curY + 1, z: aheadZ },  // head level ahead
      { x: aheadX, y: curY + 2, z: aheadZ },  // above head ahead (ceiling of next step)
      { x: aheadX, y: curY, z: aheadZ },       // feet level ahead
    ];

    // Check for lava before digging
    let lavaFound = false;
    for (const bp of blocksToDig) {
      for (const [cx, cy, cz] of [[0,0,0],[0,1,0],[0,-1,0],[hDir.dx,0,hDir.dz]]) {
        const checkBlock = bot.blockAt(new Vec3(bp.x + cx, bp.y + cy, bp.z + cz));
        if (checkBlock?.name === "lava") {
          lavaFound = true;
          break;
        }
      }
      if (lavaFound) break;
    }
    if (lavaFound) {
      return `Staircase stopped: LAVA detected! Climbed ${blocksClimbed}/${height} blocks. Position: (${curX}, ${curY}, ${curZ}).`;
    }

    // Dig the blocks
    for (const bp of blocksToDig) {
      const block = bot.blockAt(new Vec3(bp.x, bp.y, bp.z));
      if (!block || block.name === "air" || block.name === "water" || block.hardness < 0) continue;
      if (block.name.includes("_ore")) {
        oresFound[block.name] = (oresFound[block.name] || 0) + 1;
      }
      try {
        await bot.lookAt(new Vec3(bp.x + 0.5, bp.y + 0.5, bp.z + 0.5));
        // Re-equip pickaxe (might have been unequipped)
        const pick = bot.inventory.items().find(i => i.name === equippedTool);
        if (pick) await bot.equip(pick, "hand");
        await bot.dig(block, true);
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.error(`[Staircase] Failed to dig ${block.name}: ${err}`);
      }
    }

    // Now place a scaffold block ahead at curY to create a step, then walk onto it
    const scaffold = getScaffoldItem();
    if (scaffold) {
      try {
        // Place block at (aheadX, curY, aheadZ) — the floor of the step ahead
        // We need a reference block below it
        const belowBlock = bot.blockAt(new Vec3(aheadX, curY - 1, aheadZ));
        if (belowBlock && belowBlock.name !== "air" && belowBlock.name !== "water") {
          await bot.equip(scaffold, "hand");
          await bot.lookAt(new Vec3(aheadX + 0.5, curY - 0.5, aheadZ + 0.5));
          await bot.placeBlock(belowBlock, new Vec3(0, 1, 0));
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (err) {
        console.error(`[Staircase] Failed to place step: ${err}`);
        // Continue anyway — might still be able to jump up
      }
    }

    // Move onto the step: walk forward and jump
    bot.setControlState("forward", true);
    bot.setControlState("jump", true);
    await new Promise(r => setTimeout(r, 400));
    bot.clearControlStates();
    await new Promise(r => setTimeout(r, 300));

    // Check if we actually gained height
    const newY = Math.floor(bot.entity.position.y);
    if (newY > curY) {
      blocksClimbed += (newY - curY);
      console.error(`[Staircase] Step ${i + 1}: Y ${curY} → ${newY} (climbed +${newY - curY})`);
    } else {
      console.error(`[Staircase] Step ${i + 1}: No height gain (Y=${newY}). Retrying with jump-place...`);
      // Try jump-placing under self (pillar style)
      const scaffoldRetry = getScaffoldItem();
      if (scaffoldRetry) {
        try {
          const belowSelf = bot.blockAt(new Vec3(curX, curY - 1, curZ));
          if (belowSelf && belowSelf.name !== "air") {
            // Dig above first
            const above1 = bot.blockAt(new Vec3(curX, curY + 2, curZ));
            if (above1 && above1.name !== "air" && above1.hardness >= 0) {
              const pick = bot.inventory.items().find(i => i.name === equippedTool);
              if (pick) await bot.equip(pick, "hand");
              await bot.lookAt(new Vec3(curX + 0.5, curY + 2.5, curZ + 0.5));
              await bot.dig(above1, true);
              await new Promise(r => setTimeout(r, 100));
            }
            // Jump-place
            await bot.equip(scaffoldRetry, "hand");
            bot.setControlState("jump", true);
            await new Promise(r => setTimeout(r, 200));
            try {
              await bot.placeBlock(belowSelf, new Vec3(0, 1, 0));
            } catch { /* ignore */ }
            bot.clearControlStates();
            await new Promise(r => setTimeout(r, 300));
            const afterJumpY = Math.floor(bot.entity.position.y);
            if (afterJumpY > curY) {
              blocksClimbed += (afterJumpY - curY);
              console.error(`[Staircase] Jump-place: Y ${curY} → ${afterJumpY}`);
            }
          }
        } catch (err) {
          console.error(`[Staircase] Jump-place failed: ${err}`);
        }
      }
    }

    // Check HP
    if (bot.health < 5) {
      console.error(`[Staircase] HP low (${bot.health}), stopping`);
      break;
    }

    // Check if we reached open sky
    const headBlock = bot.blockAt(new Vec3(
      Math.floor(bot.entity.position.x),
      Math.floor(bot.entity.position.y) + 3,
      Math.floor(bot.entity.position.z)
    ));
    if (headBlock?.name === "air") {
      // Check if sky is visible (no solid blocks for several blocks above)
      let skyVisible = true;
      for (let dy = 3; dy < 10; dy++) {
        const above = bot.blockAt(new Vec3(
          Math.floor(bot.entity.position.x),
          Math.floor(bot.entity.position.y) + dy,
          Math.floor(bot.entity.position.z)
        ));
        if (above && above.name !== "air" && above.name !== "water") {
          skyVisible = false;
          break;
        }
      }
      if (skyVisible) {
        console.error(`[Staircase] Reached open sky!`);
        break;
      }
    }
  }

  // Collect items
  await new Promise(r => setTimeout(r, 500));
  const inventoryAfter = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
  const itemsCollected = inventoryAfter - inventoryBefore;

  const finalPos = bot.entity.position;
  let result = `Staircase up: climbed ${blocksClimbed} blocks (Y: ${Math.floor(startPos.y)} → ${Math.floor(finalPos.y)}) with ${equippedTool}.`;
  result += ` Position: (${Math.floor(finalPos.x)}, ${Math.floor(finalPos.y)}, ${Math.floor(finalPos.z)}).`;

  if (blocksClimbed < height && bot.health >= 5) {
    result += ` Reached open sky or surface.`;
  } else if (bot.health < 5) {
    result += ` STOPPED: HP too low (${bot.health.toFixed(1)}).`;
  }

  result += ` Items collected: ${itemsCollected}.`;

  if (Object.keys(oresFound).length > 0) {
    const oreList = Object.entries(oresFound).map(([name, count]) => `${name}x${count}`).join(", ");
    result += ` ORES FOUND: ${oreList}!`;
  }

  return result;
}

/**
 * Dig a 1x2 tunnel in a direction
 * Auto-equips pickaxe, collects items, reports ores found
 */
export async function digTunnel(
  managed: ManagedBot,
  direction: "north" | "south" | "east" | "west" | "down" | "up",
  length: number = 10
): Promise<string> {
  const bot = managed.bot;
  const startPos = bot.entity.position.clone();
  const inventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);

  // Handle "up" direction separately — staircase mining upward
  if (direction === "up") {
    return await digStaircaseUp(managed, length);
  }

  // Direction vectors for horizontal and down
  const dirVectors: Record<string, { dx: number; dy: number; dz: number }> = {
    north: { dx: 0, dy: 0, dz: -1 },
    south: { dx: 0, dy: 0, dz: 1 },
    east: { dx: 1, dy: 0, dz: 0 },
    west: { dx: -1, dy: 0, dz: 0 },
    down: { dx: 0, dy: -1, dz: 0 },
  };

  const dir = dirVectors[direction];
  if (!dir) {
    throw new Error(`Invalid direction: ${direction}. Use north/south/east/west/down/up`);
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
    console.error(`[Portal] Bot is already inside ${activePortalName} block, will re-enter to reset portal timer...`);
  }

  // Temporarily allow stepping on portal blocks (normally avoided to prevent accidental teleport)
  const netherPortalId = bot.registry.blocksByName["nether_portal"]?.id;
  const endPortalId = bot.registry.blocksByName["end_portal"]?.id;

  try {
    if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.delete(netherPortalId);
    if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.delete(endPortalId);

    // Always do movement regardless of alreadyInPortal status
    // Re-entering resets the 4-second portal timer and overrides any stale position state
    {
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

    // Verify bot is actually inside the portal block
    const feetBlock = bot.blockAt(bot.entity.position.floored());
    const botPos = bot.entity.position;
    console.error(`[Portal] Pre-teleport check: bot at (${botPos.x.toFixed(2)}, ${botPos.y.toFixed(2)}, ${botPos.z.toFixed(2)}), feet block: ${feetBlock?.name}`);

    // If not inside portal, walk into it using actual movement
    if (feetBlock?.name !== activePortalName) {
      console.error(`[Portal] Bot is NOT inside portal block, walking in...`);
      const portalCenter = lowestPortal.position.offset(0.5, 0, 0.5);
      await bot.lookAt(portalCenter);
      bot.setControlState("forward", true);
      // Walk forward for 2 seconds to ensure we're inside
      await new Promise(r => setTimeout(r, 2000));
      bot.clearControlStates();
      await new Promise(r => setTimeout(r, 300));
      const newFeetBlock = bot.blockAt(bot.entity.position.floored());
      console.error(`[Portal] After walking: feet block: ${newFeetBlock?.name}, pos: (${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)})`);
    }

    // Clear all movement — bot must stand completely still inside portal for ~4s
    bot.clearControlStates();
    bot.pathfinder.setGoal(null);
    console.error(`[Portal] Standing still inside portal, waiting for teleport...`);

    // Wait for dimension change with retry logic
    // Each attempt: walk into portal center, stand still for 10s, check dimension
    const portalCenter = lowestPortal.position.offset(0.5, 0, 0.5);
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.error(`[Portal] Teleport attempt ${attempt}/${maxAttempts}...`);

      const result = await new Promise<string | null>((resolve) => {
        let done = false;

        const timeout = setTimeout(() => {
          if (!done) {
            done = true;
            bot.removeListener("spawn", onSpawn);
            // Final dimension check
            if (bot.game.dimension !== startDimension) {
              resolve(getDimName(bot.game.dimension));
            } else {
              resolve(null); // timed out
            }
          }
        }, 10000);

        const onSpawn = () => {
          // Delay check — dimension may update slightly after spawn
          setTimeout(() => {
            if (!done && bot.game.dimension !== startDimension) {
              done = true;
              clearTimeout(timeout);
              bot.removeListener("spawn", onSpawn);
              resolve(getDimName(bot.game.dimension));
            }
          }, 300);
        };

        bot.on("spawn", onSpawn);

        // Also poll every 1s as fallback
        const poller = setInterval(() => {
          if (done) { clearInterval(poller); return; }
          if (bot.game.dimension !== startDimension) {
            done = true;
            clearTimeout(timeout);
            clearInterval(poller);
            bot.removeListener("spawn", onSpawn);
            resolve(getDimName(bot.game.dimension));
          }
        }, 1000);

        // Clean up poller when done
        setTimeout(() => clearInterval(poller), 11000);
      });

      if (result) {
        // Success — teleported!
        if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(netherPortalId);
        if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(endPortalId);
        return `Teleported to ${result} via portal. Position: (${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)})`;
      }

      // Failed — walk out and back in to reset the portal's 4-second timer
      if (attempt < maxAttempts) {
        console.error(`[Portal] Attempt ${attempt} failed. Walking out and back in...`);

        // Determine step-out direction based on portal axis
        const portalState = lowestPortal.getProperties() as any;
        const portalAxis = portalState?.axis as string | undefined;
        const stepOutOffset = portalAxis === "x"
          ? new Vec3(0, 0, 2)    // step out along Z
          : new Vec3(2, 0, 0);   // step out along X

        const stepOutPos = portalCenter.plus(stepOutOffset);

        // Walk out
        await bot.lookAt(stepOutPos);
        bot.setControlState("forward", true);
        await new Promise(r => setTimeout(r, 1500));
        bot.clearControlStates();
        await new Promise(r => setTimeout(r, 500));

        // Walk back in
        await bot.lookAt(portalCenter);
        bot.setControlState("forward", true);
        await new Promise(r => setTimeout(r, 2000));
        bot.clearControlStates();
        await new Promise(r => setTimeout(r, 300));

        const checkBlock = bot.blockAt(bot.entity.position.floored());
        console.error(`[Portal] Re-entered portal, feet block: ${checkBlock?.name}`);
      }
    }

    // All attempts failed
    if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(netherPortalId);
    if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(endPortalId);
    throw new Error(`Portal teleport failed after ${maxAttempts} attempts (~30s). Bot feet block: ${bot.blockAt(bot.entity.position.floored())?.name}. The bot may not be physically inside the portal block.`);

    function getDimName(dim: any): string {
      const d = String(dim);
      return d.includes("nether") ? "Nether" :
             d.includes("overworld") ? "Overworld" :
             d.includes("end") ? "End" : d;
    }
  } catch (err) {
    // Re-add portals to blocksToAvoid on failure
    if (netherPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(netherPortalId);
    if (endPortalId !== undefined) bot.pathfinder.movements.blocksToAvoid.add(endPortalId);
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to enter portal: ${errMsg}`);
  }
}
