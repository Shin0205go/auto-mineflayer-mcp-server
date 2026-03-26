import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
const { GoalBlock } = goals;
import type { ManagedBot } from "./types.js";
import { isHostileMob, checkGroundBelow, isNearCliffEdge, KNOCKBACK_MOBS, EDIBLE_FOOD_NAMES, isWaterBlock, isLavaBlock } from "./minecraft-utils.js";
import { equipArmor } from "./bot-items.js";
import { safeSetGoal } from "./pathfinder-safety.js";

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
async function moveToBasic(managed: ManagedBot, x: number, y: number, z: number, options?: { allowDig?: boolean }): Promise<{ success: boolean; message: string; stuckReason?: string }> {
  const bot = managed.bot;
  const targetPos = new Vec3(x, y, z);

  // PRE-CLEANUP: Clear stale pathfinder state before starting new navigation.
  // Bot1 [2026-03-22]: moveTo completely stuck at (28.7, 69.2, 16.9) after flee().
  // flee() sets a GoalNear, and if the flee promise resolves while pathfinder is still
  // processing, the old goal/listeners persist. The new setGoal() in this function then
  // conflicts, causing the pathfinder to oscillate or freeze. Explicitly nullifying the
  // goal and clearing movement controls ensures a clean slate for each navigation.
  try { bot.pathfinder.setGoal(null); } catch (_) { /* ignore if no pathfinder */ }
  bot.setControlState("forward", false);
  bot.setControlState("back", false);
  bot.setControlState("sprint", false);
  bot.setControlState("jump", false);

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
    let monitorTickCount = 0; // Increments each 500ms check interval
    let maxHeightReached = start.y;
    let underwaterTicks = 0; // Track consecutive checks with head underwater
    const startHp = bot.health ?? 20; // Track HP at navigation start for rapid-drop detection
    // High mountain flag: Y>90 peaks require relaxed drop/fall limits (see maxDropDown and physicsTick below)
    const isHighMountainStart = start.y > 90;
    // Declare checkInterval first to avoid TDZ issues when event handlers fire early
    let checkInterval: ReturnType<typeof setInterval> | null = null;
    let lastPos = start.clone();
    let pathResetCount = 0;
    let notMovingCount = 0;
    // OVERALL PROGRESS CHECK: Track distance-to-target every 30s (60 ticks).
    // Catches the pattern where pathfinder keeps resetting (isMoving()=true, noProgressCount=0
    // because bot moves slightly each 500ms) but bot makes no real progress toward the target.
    // Session 79 [2026-03-26]: bot at (-112,77,20) → moveTo(0,77,9): pathfinder ran for 120s
    // with no forward movement because dense birch forest or mobs blocked every computed path.
    // The 0.1-block noProgressCount check was reset by small physics jitter (±0.05 blocks).
    // Every 60 checks (30s), compare distance-to-target. If bot is not within 5 blocks closer
    // than 30s ago, declare stuck. This is the macro-scale complement to micro-scale noProgressCount.
    let lastProgressCheckDist = start.distanceTo(targetPos);
    let progressCheckTickCount = 0;

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
      // CRITICAL: Clear all movement control states on EVERY finish (success or failure).
      // Bot1/Bot2/Bot3 [2026-03-22]: multiple deaths where safety checks (creeper, hostile,
      // HP drop, underground routing, cliff-knockback, high-route) called finish() to abort
      // navigation, but the bot kept moving forward because pathfinder control states
      // (forward, sprint, jump) were not cleared. setGoal(null) stops pathfinder planning
      // but does NOT immediately clear the movement controls set during the current tick.
      // The bot continues moving for 1-2 ticks after abort — enough to walk into a creeper
      // explosion radius, off a cliff edge, or deeper into a cave.
      // Previously only underwater (line 271) and fall (line 629) aborts cleared controls.
      try { bot.clearControlStates(); } catch (_) {}
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
      monitorTickCount++;

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

      // SAFETY: Detect water contact — abort if bot enters water (head OR feet).
      // Bot1 Session 39,44: pathfinder routed through water, bot drowned.
      // Bot1 [2026-03-23]: moveTo(0,72,80) routed bot into water at Y=114, drowned.
      // liquidCost=10000 discourages water paths but doesn't prevent them when no
      // land route is found. The pathfinder falls back to water routing silently.
      //
      // Two-tier detection:
      //   Tier 1 (head underwater): 2 consecutive checks (1s) → immediate abort + swim up.
      //     Reduced from 4 (2s) — at 4 checks the bot has already lost 2-3 air bubbles
      //     and may be deep enough that swimming up takes longer than remaining air.
      //   Tier 2 (feet in water, head dry): 3 consecutive checks (1.5s) → abort.
      //     Catches wading-through-river routing where head stays above water but bot
      //     is being led through a water body. 3 checks filters brief puddle crossings.
      const headBlock = bot.blockAt(currentPos.offset(0, 1.6, 0).floor());
      const feetBlock = bot.blockAt(currentPos.floor());
      const headInWater = headBlock && isWaterBlock(headBlock.name);
      const feetInWater = feetBlock && isWaterBlock(feetBlock.name);

      if (headInWater || feetInWater) {
        underwaterTicks++;
        const abortThreshold = headInWater ? 2 : 3;
        if (underwaterTicks >= abortThreshold) {
          const waterLevel = headInWater ? "head underwater" : "feet in water";
          console.error(`[MoveTo] DROWNING RISK: ${waterLevel} for ${underwaterTicks} checks at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Aborting navigation.`);
          bot.pathfinder.stop();
          finish({
            success: false,
            message: `Navigation stopped: ${waterLevel} at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Drowning risk. Use bot.navigate() to find land, or hold jump to swim up.`,
            stuckReason: "underwater"
          });
          // Try to swim up AFTER finish() — finish() clears all control states,
          // so setting jump=true must come after to persist.
          // Auto-clear jump after 5s to prevent infinite jumping on land after escaping water.
          try {
            bot.setControlState("jump", true);
            setTimeout(() => { try { bot.setControlState("jump", false); } catch (_) {} }, 5000);
          } catch (_) {}
          return;
        }
      } else {
        underwaterTicks = 0;
      }

      // SAFETY: Track maximum height reached during pathfinding
      // If bot goes much higher than start or target, pathfinder may be taking unsafe route.
      // Bot3 Death #4: pathfinder routed to Y=112 when going from Y=9 to Y=64, then fell.
      // Bot1 [2026-03-23]: fell from Y=85 during moveTo — pathfinder took an elevated route.
      // Abort if bot climbs more than 10 blocks above BOTH start and target — this means
      // the pathfinder is taking a dangerous high-altitude route that risks a lethal fall.
      // Reduced from 15 to 10: 15 blocks was too generous — by the time the bot is 15 blocks
      // above target, a fall is almost certainly lethal (fall damage starts at 4 blocks).
      if (currentPos.y > maxHeightReached) {
        maxHeightReached = currentPos.y;
        const heightAboveStart = currentPos.y - start.y;
        const heightAboveTarget = currentPos.y - y;
        if (heightAboveStart > 10 && heightAboveTarget > 10) {
          console.error(`[MoveTo] DANGEROUS HIGH ROUTE: Bot climbed ${heightAboveStart.toFixed(1)} blocks above start and ${heightAboveTarget.toFixed(1)} above target (Y=${start.y.toFixed(1)} → Y=${currentPos.y.toFixed(1)}, target Y=${y.toFixed(1)}). Aborting to prevent fall death.`);
          finish({
            success: false,
            message: `Navigation stopped: pathfinder climbed too high (Y=${currentPos.y.toFixed(0)}, start Y=${start.y.toFixed(0)}, target Y=${y.toFixed(0)}). High-altitude route risks lethal fall. Try shorter segments or a different waypoint.`,
            stuckReason: "high_route"
          });
          return;
        }
        if (heightAboveStart > 6) {
          console.error(`[MoveTo] WARNING: Bot climbing too high (${heightAboveStart.toFixed(1)} blocks above start). May take dangerous falling route.`);
        }
      }

      // SAFETY: Absolute Y floor check — if start Y >= 62 and target Y >= 62 (surface navigation),
      // abort immediately if bot goes below Y=62. This catches cave routing faster than the
      // descent-from-start check (which fires every 500ms and may be too slow if the bot
      // walks quickly into a cave opening).
      // Bot1 Session 69c [2026-03-25]: pathfinder routed bot from spawn (Y~70) to underground
      // water pocket at Y=58, X=48, Z=22. The 3-block descent limit fires too late because
      // the bot crosses the cave entrance quickly. An absolute Y<62 floor prevents this
      // regardless of descent speed.
      // Sea level in Minecraft is Y=63. Y<62 is always underground in the overworld.
      // Exception: don't apply if start or target is already underground (both < 62).
      {
        const surfaceNavigation = start.y >= 62 && y >= 62;
        if (surfaceNavigation && currentPos.y < 62) {
          console.error(`[MoveTo] ABSOLUTE Y FLOOR: Bot dropped to Y=${currentPos.y.toFixed(1)} during surface navigation (start Y=${start.y.toFixed(1)}, target Y=${y}). Y<62 = underground. Aborting immediately.`);
          finish({
            success: false,
            message: `Navigation stopped: bot went underground (Y=${currentPos.y.toFixed(0)}) during surface navigation (start Y=${start.y.toFixed(0)}, target Y=${y}). Pathfinder routed through cave. Try navigating in shorter segments or to a different waypoint.`,
            stuckReason: "underground_routing",
          });
          return;
        }
      }

      // SAFETY: Detect underground cave routing — abort if bot descends far below expected path.
      // Case 1: Target is at/above start — bot should NOT descend more than N blocks below start.
      //   Normal surface (Y<=75): limit = 3 blocks. Strict limit prevents cave routing.
      //   Elevated terrain (Y>75): limit = 18 blocks. At Y=80-92 (birch forest hilltop),
      //   all natural terrain paths descend 5-18 blocks — the old 10-block limit falsely fired,
      //   making ALL movement impossible from any elevated spawn position.
      //   Bot1 Session 72d [2026-03-26]: bot at Y=80, moveTo to any coordinate always returned
      //   to same position (5,80,-9). Terrain descent of 11-17 blocks (normal birch forest
      //   valley traversal) was triggering underground_routing abort at every pathfinder attempt.
      //   The absolute Y<62 floor check (above) is the real protection against cave routing —
      //   case1DescentLimit is redundant secondary protection. For elevated starts (Y>75),
      //   real floor is Y=62, which is 13-30 blocks below start. Raising limit to 18 blocks
      //   allows birch forest valley traversal (typical 10-18 block descent) while the
      //   absolute floor check still catches any actual underground routing (Y<62).
      //   Bot1 Session 56: bot stranded at Y=92, moveTo/flee/pillarUp/gather all returned
      //   immediately because the 3-block (then 10-block) limit prevented any downhill path.
      //   For normal surface Y<=75: keep 3-block limit to prevent cave routing at ground level.
      // Case 2: Target is below start — allow descent proportional to target depth.
      //   Bot1 Session 44: navigated to (100,96,0) from surface, ended at Y=72 in cave, drowned.
      //   Bot3 Death #11: navigated to farm, fell into ravine via pathfinder digging.
      //   Bot3 Death #4: navigated from Y=9 to Y=64, pathfinder went to Y=112 then fell.
      const yDescentFromStart = start.y - currentPos.y;
      const targetIsAtOrAboveStart = y >= start.y - 5; // target within 5 blocks below start is "surface-level"
      // Elevated terrain adjustment: at Y>75 (mountain/cliff/treetop), 3-block limit is too tight.
      // Natural descent from elevated positions spans 5-18 blocks — not cave routing.
      // Use 18-block limit above Y=75 to allow descent without triggering false underground abort.
      // High mountain exception (Y>90): peaks like Y=108 (mountains biome) require descending
      // 30-46 blocks to reach ground level (Y=62-78). The 18-block limit (for Y>75) fires
      // immediately at these heights, making ALL movement impossible from mountain peaks.
      // Bot1 Session 81 [2026-03-26]: bot stranded at Y=108, all 4 moveTo directions failed —
      // descent of 28-38 blocks triggered underground_routing abort at every attempt.
      // Fix: at Y>90, allow descent up to (start.y - 62 + 5) — i.e., allow reaching sea level
      // from any mountain height. The absolute Y<62 floor check is the real cave protection.
      const elevatedStart = start.y > 75;
      const case1DescentLimit = isHighMountainStart
        ? Math.max(start.y - 62 + 5, 18) // mountains: allow descent to near sea level
        : elevatedStart ? 18 : 3;
      if (targetIsAtOrAboveStart && yDescentFromStart > case1DescentLimit) {
        console.error(`[MoveTo] UNDERGROUND ROUTING DETECTED: Bot descended ${yDescentFromStart.toFixed(1)} blocks below start (Y=${start.y.toFixed(1)} → Y=${currentPos.y.toFixed(1)}) while target Y=${y.toFixed(1)} is at/above start. Pathfinder is routing through caves. Aborting. (limit=${case1DescentLimit} for ${elevatedStart ? "elevated" : "surface"} start)`);
        finish({
          success: false,
          message: `Navigation stopped: pathfinder routed underground (Y=${start.y.toFixed(0)} → Y=${currentPos.y.toFixed(0)}, target Y=${y.toFixed(0)}). Bot was descending into cave system. Try navigating in shorter segments or to a different waypoint.`,
          stuckReason: "underground_routing"
        });
        return;
      }
      // Case 2: target is significantly below start — allow descent but catch cave routing.
      // Two sub-checks:
      //   2a) Dynamic max descent from start: allow descent proportional to the actual Y difference
      //       to the target, plus a 5-block buffer for terrain meandering.
      //       Previous flat 8-block limit was too restrictive: Bot1/Bot2/Bot3 [2026-03-22] could
      //       not reach chests/infrastructure 10-15 blocks below (e.g., bot at Y=99, chest at Y=88).
      //       The moveToBasic cave detection fired at 8 blocks down, aborting legitimate navigation.
      //       New: max descent = (startY - targetY) + 5, capped at 25 for elevated start (was 20).
      //       Elevated start (Y>75) gets cap=25 to allow descent from cliffs to ground level.
      //       Session 56: bot at Y=92 → Y=70 requires 22 blocks descent; old cap=20 triggered abort.
      //   2b) Overshoot: bot should not go more than 5 blocks below target Y.
      if (!targetIsAtOrAboveStart) {
        // 2a: Dynamic max descent from start — proportional to target depth
        const expectedDescent = start.y - y; // how far down the target is
        // Elevated starts (Y>75) get higher cap to allow cliff/mountain descent to ground level.
        // CRITICAL FIX (Session 79 [2026-03-26]): When bot is on surface (start.y>=62) and
        // target is underground (y<62), cap descent at (start.y - 62 + 5) to prevent routing
        // into underground caves. Previously maxDescentCap=30 for elevated starts let a bot at
        // Y=77 descend to Y=47 — well into underground water pockets — because:
        //   - The absolute Y<62 floor check only fires when target Y>=62 (§L351)
        //   - The case1 descent limit doesn't apply (target is below start by >5)
        //   - maxDescentCap=30 allowed 30-block descent without cave detection
        // Result: gather("stone") routed bot from Y=77 to stone at Y=49, bot drowned.
        // New logic: if start is on surface and target is underground, the maximum SAFE
        // descent is (start.y - 62 + 5) — i.e., stop 5 blocks below sea level.
        // This preserves legitimate deep descents when target is ALSO underground (both <62).
        const undergroundTarget = y < 62;
        const surfaceStart = start.y >= 62;
        let maxDescentCap: number;
        if (surfaceStart && undergroundTarget) {
          // Surface-to-underground: cap at sea level + 5 buffer to prevent cave routing.
          // e.g. bot at Y=77 → max descent = 77-62+5 = 20 blocks (stops at Y=57).
          maxDescentCap = Math.max(start.y - 62 + 5, 10); // min 10 as absolute floor
        } else {
          // Normal elevated or underground navigation: use fixed caps.
          maxDescentCap = elevatedStart ? 30 : 20;
        }
        const maxAllowedDescent = Math.min(expectedDescent + 5, maxDescentCap);
        if (yDescentFromStart > maxAllowedDescent) {
          console.error(`[MoveTo] CAVE DESCENT DETECTED: Bot descended ${yDescentFromStart.toFixed(1)} blocks below start (Y=${start.y.toFixed(1)} → Y=${currentPos.y.toFixed(1)}, target Y=${y.toFixed(1)}, max allowed=${maxAllowedDescent.toFixed(0)}). Aborting to prevent underground trapping.`);
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
      // IMPORTANT: Use 3D distance but EXCLUDE creeperss that are ≥4 blocks BELOW the bot.
      // A creeper on the ground while the bot is on a pillar (Y+4 or more) cannot explode
      // the bot — its explosion radius is ~3 blocks. Without this exception, the bot is
      // permanently stuck on a pillar because all moveTo calls abort the instant they start.
      // Bot1 [2026-03-25]: pillarUp(10) succeeded but every subsequent moveTo aborted at
      // <500ms due to creeper_danger (creeperss at ground level, Y-10 from bot position).
      {
        let creeperNearby = false;
        let creeperDist = Infinity;
        for (const entity of Object.values(bot.entities)) {
          if (!entity || !entity.position || entity === bot.entity) continue;
          const eName = entity.name?.toLowerCase() ?? "";
          if (eName === "creeper") {
            const verticalOffset = currentPos.y - entity.position.y; // positive = creeper is below
            // Skip creeperss that are ≥4 blocks below (explosion won't reach from that depth)
            if (verticalOffset >= 4) continue;
            const eDist = entity.position.distanceTo(currentPos);
            if (eDist < 8) {
              creeperNearby = true;
              creeperDist = Math.min(creeperDist, eDist);
            }
          }
        }
        if (creeperNearby) {
          console.error(`[MoveTo] CREEPER DANGER: Creeper at ${creeperDist.toFixed(1)} blocks during navigation. HP=${navHp.toFixed(1)}. Aborting + emergency sprint away.`);
          // Find the creeper entity to sprint away from it
          let creeperEntity: any = null;
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            if ((entity.name?.toLowerCase() ?? "") === "creeper") {
              const eDist = entity.position.distanceTo(currentPos);
              if (eDist < 8) { creeperEntity = entity; break; }
            }
          }
          finish({
            success: false,
            message: `Navigation aborted: CREEPER at ${creeperDist.toFixed(1)} blocks! HP=${Math.round(navHp*10)/10}. Position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_flee IMMEDIATELY — creeper explosion is lethal at close range.`,
            stuckReason: "creeper_danger"
          });
          // Emergency sprint away from creeper after finish() clears states.
          // Creeper fuse is 1.5s — every millisecond counts.
          try {
            if (creeperEntity) {
              const cPos = creeperEntity.position;
              const fleeYaw = Math.atan2(-(currentPos.x - cPos.x), currentPos.z - cPos.z);
              bot.look(fleeYaw, 0, true);
            }
            bot.setControlState("sprint", true);
            bot.setControlState("forward", true);
            bot.setControlState("jump", true); // Jump over obstacles while fleeing
            setTimeout(() => {
              try { bot.clearControlStates(); } catch { /* ignore */ }
            }, 2000);
          } catch { /* ignore retreat errors */ }
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
        // Scan radius and HP thresholds: food-aware.
        // Without food, any damage is permanent — widen scan and raise HP threshold.
        // Bot2 [2026-03-23]: killed during daytime nav with no food; old threshold (10)
        // let bot keep navigating until HP was already critical. With food the bot can
        // regenerate so lower thresholds are acceptable.
        const b3HasFood = bot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
        const scanRadius = navIsNight ? 16 : (b3HasFood ? 10 : 16);
        // Night HP thresholds (high — mobs are everywhere):
        //   Unarmored: 14, Partial: 12, Full: 10
        // Daytime HP thresholds — tighter without food (damage is permanent):
        //   With food:    Unarmored: 10, Partial: 8,  Full: 6
        //   Without food: Unarmored: 14, Partial: 12, Full: 8
        const hpThreshold = navIsNight
          ? (armorCount <= 1 ? 14 : armorCount <= 3 ? 12 : 10)
          : b3HasFood
            ? (armorCount <= 1 ? 10 : armorCount <= 3 ? 8 : 6)
            : (armorCount <= 1 ? 14 : armorCount <= 3 ? 12 : 8);

        // Check B1: Ranged mob proximity — skeletons/pillagers shoot from 16+ blocks.
        // This check fires regardless of HP because ranged mobs deal damage before
        // the bot can react — even full HP drains fast with no armor.
        // Bot1 Sessions 22,35, Bot2 [2026-03-22]: killed by skeleton during daytime
        // at HP >= 12 because scan radius (10) was shorter than skeleton attack range (16+).
        // Bot1/Bot2 [2026-03-22]: killed by pillagers during daytime navigation.
        // Ranged mobs are uniquely dangerous: they attack while the bot is walking,
        // dealing repeated damage before the next safety check fires (500ms interval).
        //
        // Expanded to armorCount <= 2 (was <= 1): drowned with tridents deal 9 damage,
        // pillagers deal 4-5 with crossbow. Even with 2 armor pieces (e.g. iron boots +
        // iron helmet), these are lethal over a 30s navigation — bot takes 3-5 hits.
        // Bot2 [2026-03-22]: killed by drowned and skeleton during navigation with partial armor.
        // Bot1 [2026-03-22]: killed by pillager during daytime with iron_boots only.
        // Added "witch" to ranged list — witches throw potions at 10+ blocks.
        const RANGED_MOBS = ["skeleton", "stray", "pillager", "drowned", "witch"];
        // Extend ranged/melee checks to armorCount<=3 when no food: without food, ALL damage
        // is permanent regardless of armor. A bot with 3 iron armor pieces still takes 2-3
        // damage per skeleton shot, and after 5-6 hits during a 30s nav, HP drops from 20 to
        // single digits with no way to recover. Previously only checked armorCount<=2, letting
        // bots with 3 armor pieces navigate through ranged threats while foodless.
        // Bot2 [2026-03-23]: killed during navigation with no food — damage accumulated
        // permanently because the armor-gate skipped the check.
        const b1HasFood = bot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
        const rangedArmorGate = b1HasFood ? 2 : 3;
        if (armorCount <= rangedArmorGate) {
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            const eDist = entity.position.distanceTo(currentPos);
            if (eDist > 16) continue;
            const eName = entity.name?.toLowerCase() ?? "";
            // Skip ranged mobs that are ≥4 blocks BELOW the bot.
            // Bot1 [2026-03-25]: on a pillar (Y+10), skeletons at ground level triggered
            // ranged_mob_danger, causing every moveTo to abort within 500ms. Skeletons
            // cannot shoot effectively straight up through solid terrain.
            const rangedVertOffset = currentPos.y - entity.position.y;
            if (rangedVertOffset >= 4) continue;
            if (RANGED_MOBS.includes(eName)) {
              const timeNote = navIsNight ? "at night" : "during daytime";
              const armorNote = armorCount === 0 ? "NO ARMOR" : `PARTIAL ARMOR (${armorCount}/4)`;
              console.error(`[MoveTo] RANGED MOB DANGER (${timeNote}): ${eName} at ${eDist.toFixed(1)} blocks, armor=${armorCount}/4, HP=${navHp.toFixed(1)}. Aborting + emergency retreat.`);
              finish({
                success: false,
                message: `Navigation aborted: ${eName} detected ${eDist.toFixed(1)} blocks away ${timeNote}, HP=${Math.round(navHp*10)/10}. ${armorNote} — ranged mobs deal 4-9 damage per shot. Position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_flee or mc_combat to handle threat first.`,
                stuckReason: "ranged_mob_danger"
              });
              // Emergency sprint away from ranged mob after abort.
              // Bot1/Bot2: standing still after ranged abort = continued arrow damage.
              try {
                const mobPos = entity.position;
                const fleeYaw = Math.atan2(-(currentPos.x - mobPos.x), currentPos.z - mobPos.z);
                bot.look(fleeYaw, 0, true);
                bot.setControlState("sprint", true);
                bot.setControlState("forward", true);
                setTimeout(() => {
                  try { bot.clearControlStates(); } catch { /* ignore */ }
                }, 1500);
              } catch { /* ignore retreat errors */ }
              return;
            }
          }
        }

        // Check B2: Close-range melee mob detection — abort at ANY HP when unarmored/partial.
        // Bot2 [2026-03-23]: zombie at 22.8m approached during navigation, killed bot at HP>14.
        // The HP-gated check below (B3) only fires at HP<=14 (unarmored at night), so a zombie
        // can walk up to the bot and land 2-3 hits (3-6 damage each) before the HP threshold
        // triggers. By that point, HP may be too low to flee successfully.
        // Daytime: abort when melee hostile within 6 blocks (close enough for imminent attack).
        // Night: expand to 12 blocks for unarmored (0-1 pieces) — zombies walk at 2.3 blocks/s,
        //   so a zombie at 12 blocks reaches melee range in ~4 seconds. With 500ms check interval,
        //   a 6-block threshold gives only 1-2 checks before impact. At 12 blocks, there are 4-5
        //   checks, giving the agent time to flee after the abort.
        //   Bot2 [2026-03-23]: zombie at 22.8m closed to melee during navigation and killed bot.
        //   The old 6-block threshold didn't trigger until the zombie was already hitting.
        // Full iron armor (4/4) absorbs enough damage to survive multiple hits, so skip for those.
        // Extended to armorCount<=3 when no food: without food, damage is permanent.
        // A bot with 3 armor pieces takes reduced damage per hit, but after 5-6 hits during
        // a 30s navigation, HP drops irreversibly to critical levels.
        const meleeArmorGate = b1HasFood ? 2 : 3;
        if (armorCount <= meleeArmorGate) {
          // Night + unarmored: wider detection. Night + partial: moderate. Day: tight.
          // Bot2 [2026-03-23]: zombie at 22.8m closed to melee during daytime navigation
          // and killed bot before the abort triggered. Without food, any damage is permanent.
          // Daytime no-food: 20 blocks — must match the pre-nav check in core-tools.ts
          // (dayBlockDist = hasFood ? 10 : 20) to close the gap where mobs pass the pre-nav
          // check at 21-24 blocks, then close in during navigation and still pass the mid-nav
          // check at 14 blocks. A zombie at 20 blocks reaches melee in ~8.7s at 2.3 blocks/s,
          // giving 17+ safety checks at 500ms interval — enough to detect and abort.
          // Night no-armor: 16 blocks (was 12) — night mob density is high and multiple mobs
          // converge from different directions. Bot1 Sessions 20-44: 15+ deaths at night from
          // mobs closing in during navigation. 12 blocks gave only 5.2s before impact.
          const navHasFood = bot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
          // Bot2 [2026-03-23]: zombie at 22.8m passed mc_navigate pre-check (dayBlockDist=20),
          // then closed in during navigation. The mid-nav meleeAbortDist was also 20, creating
          // a gap where mobs at 20-24 blocks could approach undetected by either check if the
          // bot moved toward them. Increase no-food daytime to 24 to match the pre-nav scan
          // radius, closing the detection gap. A zombie at 24 blocks reaches melee in ~10.4s
          // at 2.3 blocks/s — with 500ms check interval, that's 20+ checks to detect and abort.
          const meleeAbortDist = navIsNight
            ? (armorCount <= 1 ? 16 : 10)
            : (navHasFood ? 6 : 24);
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            const eDist = entity.position.distanceTo(currentPos);
            if (eDist > meleeAbortDist) continue;
            const eName = entity.name?.toLowerCase() ?? "";
            // Skip ranged mobs — already handled by check B1 above at 16-block radius.
            if (RANGED_MOBS.includes(eName)) continue;
            // Skip mobs that are ≥4 blocks BELOW the bot (bot is elevated on a pillar).
            // Melee mobs can only hit if at same Y level. A zombie 4+ blocks below on the
            // ground cannot reach a bot on top of a pillar. Without this exception, every
            // moveTo aborts immediately when the bot is on a pillar above a hostile area.
            // Bot1 [2026-03-25]: 10+ consecutive moveTo failures on pillar top due to
            // melee_mob_danger check firing even when mobs were far below on the ground.
            const meleeVertOffset = currentPos.y - entity.position.y;
            if (meleeVertOffset >= 4) continue;
            if (isHostileMob(bot, eName)) {
              const timeNote = navIsNight ? "at night" : "during daytime";
              const armorNote = armorCount === 0 ? "NO ARMOR" : `PARTIAL ARMOR (${armorCount}/4)`;
              console.error(`[MoveTo] CLOSE MELEE DANGER (${timeNote}): ${eName} at ${eDist.toFixed(1)} blocks, armor=${armorCount}/4, HP=${navHp.toFixed(1)}. Aborting + emergency retreat.`);
              // Emergency retreat: look away from the mob and sprint-walk for 1s.
              // finish() clears control states, but we set them AFTER finish to persist.
              // Bot2 [2026-03-23]: after abort, bot stood still for 2-4s waiting for agent
              // to call mc_flee — zombie closed remaining distance and killed bot.
              // Emergency retreat buys ~2 extra blocks of distance, giving the agent time.
              finish({
                success: false,
                message: `Navigation aborted: ${eName} within ${eDist.toFixed(1)} blocks ${timeNote}, HP=${Math.round(navHp*10)/10}. ${armorNote} — melee mob approaching. Position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_flee or mc_combat to handle threat first.`,
                stuckReason: "melee_mob_danger"
              });
              // After finish (which clears states), set emergency retreat: face away from mob and sprint
              try {
                const mobPos = entity.position;
                const fleeYaw = Math.atan2(-(currentPos.x - mobPos.x), currentPos.z - mobPos.z);
                bot.look(fleeYaw, 0, true);
                bot.setControlState("sprint", true);
                bot.setControlState("forward", true);
                // Auto-clear after 1.5s to prevent indefinite running
                setTimeout(() => {
                  try { bot.clearControlStates(); } catch { /* ignore */ }
                }, 1500);
              } catch { /* ignore retreat errors */ }
              return;
            }
          }
        }

        // Check B3: HP-gated hostile detection — broader scan, fires when HP is already low.
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
            console.error(`[MoveTo] HOSTILE DANGER (${timeNote}): HP=${navHp.toFixed(1)}, armor=${armorCount}/4, ${nearHostiles.length} hostile(s) nearby: ${threatList}. Aborting + emergency retreat.`);
            finish({
              success: false,
              message: `Navigation aborted: HP=${Math.round(navHp*10)/10} ${timeNote} with ${nearHostiles.length} hostile(s) nearby (${threatList}).${armorNote} Current position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_flee, build shelter, or wait for dawn.`,
              stuckReason: navIsNight ? "night_danger" : "daytime_danger"
            });
            // Emergency retreat from closest threat after abort
            try {
              const closestEntity = Object.values(bot.entities).find((e: any) =>
                e && e.position && e !== bot.entity &&
                (e.name?.toLowerCase() ?? "") === closestThreat.name &&
                e.position.distanceTo(currentPos) < scanRadius + 5
              );
              if (closestEntity && closestEntity.position) {
                const fleeYaw = Math.atan2(-(currentPos.x - closestEntity.position.x), currentPos.z - closestEntity.position.z);
                bot.look(fleeYaw, 0, true);
              }
              bot.setControlState("sprint", true);
              bot.setControlState("forward", true);
              setTimeout(() => {
                try { bot.clearControlStates(); } catch { /* ignore */ }
              }, 1500);
            } catch { /* ignore retreat errors */ }
            return;
          }
        }
      }

      // Check C: Cliff-edge + knockback mob detection — abort at ANY HP.
      // Bot1 Session 21b: "doomed to fall by Skeleton" — skeleton knockback on cliff edge.
      // Bot2 [2026-03-22]: "doomed to fall by Pillager/Skeleton" — knockback fall deaths on
      // elevated terrain. These deaths happen regardless of HP because the knockback itself
      // pushes the bot off the edge, and fall damage is the killer.
      // Only check every ~2.5s (5 ticks) to avoid performance impact from block scanning.
      if (monitorTickCount % 5 === 0) {
        const cliffCheck = isNearCliffEdge(bot, currentPos);
        if (cliffCheck.nearEdge && cliffCheck.maxFallDistance > 4) {
          // Check for knockback-capable mobs within 16 blocks (skeleton range ~15 blocks)
          const knockbackThreats: Array<{ name: string; dist: number }> = [];
          for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity === bot.entity) continue;
            const eDist = entity.position.distanceTo(currentPos);
            if (eDist > 16) continue;
            const eName = entity.name?.toLowerCase() ?? "";
            if (KNOCKBACK_MOBS.includes(eName) || (isHostileMob(bot, eName) && eDist < 6)) {
              knockbackThreats.push({ name: eName, dist: Math.round(eDist * 10) / 10 });
            }
          }
          if (knockbackThreats.length > 0) {
            const kbThreatList = knockbackThreats.sort((a, b) => a.dist - b.dist).slice(0, 3).map(h => `${h.name}(${h.dist}m)`).join(", ");
            console.error(`[MoveTo] CLIFF-EDGE KNOCKBACK DANGER: Near ${cliffCheck.maxFallDistance}-block drop (${cliffCheck.edgeDirections.join(",")}), ${knockbackThreats.length} knockback mob(s): ${kbThreatList}. Aborting.`);
            finish({
              success: false,
              message: `Navigation aborted: CLIFF EDGE with ${cliffCheck.maxFallDistance}-block drop (${cliffCheck.edgeDirections.join(",")}) + knockback mob(s) nearby (${kbThreatList}). Knockback can push you off the edge — fatal fall. Move away from cliff edge first, or use mc_flee.`,
              stuckReason: "cliff_knockback_danger"
            });
            return;
          }
        }
      }

      // SAFETY: Rapid HP drop detection — abort if HP dropped significantly during this navigation.
      // Bot1 Sessions 20-44, Bot2, Bot3: many deaths where bot took damage from mobs during
      // a single moveTo call. AutoFlee only triggers at HP<=10, but the hostile detection
      // above requires HP to be BELOW threshold AND hostiles in scan radius — timing gaps
      // mean mobs can hit the bot between scans. This catches any source of HP loss (mobs,
      // fall damage, drowning, fire, etc.) by monitoring total HP drop since nav started.
      // Two-tier threshold:
      //   - With food: 6+ HP lost AND currentHp < 14 (original)
      //   - Without food: 4+ HP lost AND currentHp < 16 (tighter)
      // Bot1/Bot2/Bot3 [2026-03-22]: multiple deaths where HP dropped 4-5 during navigation
      // with no food. The 6-HP threshold was too late — without food, HP never recovers,
      // so every point of damage is permanent. A 4-HP drop without food is equivalent to
      // a 6-HP drop with food (since food allows regen back to full).
      {
        const currentHp = bot.health ?? 0;
        const hpDrop = startHp - currentHp;
        // Use EDIBLE_FOOD_NAMES instead of isFoodItem for consistency with mc_navigate
        // pre-checks. isFoodItem includes spider_eye (causes poison) which shouldn't
        // count as "has food" for safety threshold calculations. A bot with only
        // spider_eye in inventory is effectively foodless — eating it costs 2 hearts
        // of poison damage, making it worse than starving.
        const hasFood = bot.inventory.items().some((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
        const dropThreshold = hasFood ? 6 : 4;
        const hpFloor = hasFood ? 14 : 16;
        // Use <= instead of < to catch exact boundary: skeleton hit from HP 20 deals 4 damage
        // → HP=16 exactly, which failed the old `< 16` check for the no-food case (hpFloor=16).
        // Bot1/Bot2 [2026-03-22]: multiple deaths where first hit brought HP to exactly the
        // threshold but abort didn't trigger, allowing a second hit to land.
        if (hpDrop >= dropThreshold && currentHp <= hpFloor) {
          const foodNote = hasFood ? "" : " No food — HP cannot regenerate.";
          console.error(`[MoveTo] RAPID HP DROP: HP dropped ${hpDrop.toFixed(1)} during navigation (${startHp.toFixed(1)} → ${currentHp.toFixed(1)}).${foodNote} Aborting to allow recovery.`);
          finish({
            success: false,
            message: `Navigation aborted: HP dropped ${hpDrop.toFixed(0)} during travel (${Math.round(startHp)} → ${Math.round(currentHp*10)/10}).${foodNote} Position: (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}). Use mc_eat to heal, mc_flee from threats, or build shelter.`,
            stuckReason: "hp_drop"
          });
          return;
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

      // OVERALL PROGRESS CHECK: Every 30s (60 checks at 500ms), verify bot is actually
      // making meaningful progress toward the target. This catches the "pathfinder running
      // but bot not advancing" pattern where small position jitter resets noProgressCount
      // and pathfinder stays isMoving()=true while the bot never advances toward target.
      // Session 79 [2026-03-26]: bot at (-112,77,20) ran moveTo(0,77,9) for 120s without
      // ever leaving the -112...-111 X range, consuming the full mc_execute timeout.
      // Only check when more than 15 blocks away (close targets may be circling around obstacles).
      progressCheckTickCount++;
      if (progressCheckTickCount >= 60 && currentDist > 15) {
        progressCheckTickCount = 0;
        const distProgress = lastProgressCheckDist - currentDist; // positive = closer to target
        if (distProgress < 5) {
          // Less than 5 blocks closer to target in 30 seconds — stuck
          const yDiff = y - currentPos.y;
          console.error(`[MoveTo] OVERALL PROGRESS TIMEOUT: ${distProgress.toFixed(1)} blocks progress in 30s toward target at (${x},${y},${z}). Pathfinder running but not advancing. Failing early instead of timing out.`);
          finish({
            success: false,
            message: `Pathfinder running but not advancing: only moved ${distProgress.toFixed(1)} blocks toward target in 30s. Stopped at (${currentPos.x.toFixed(1)}, ${currentPos.y.toFixed(1)}, ${currentPos.z.toFixed(1)}), ${currentDist.toFixed(1)} blocks from target. Try a waypoint closer to ${x},${z} or clear the area first.`,
            stuckReason: Math.abs(yDiff) > 2 ? (yDiff > 0 ? "target_higher" : "target_lower") : "pathfinder_stopped"
          });
          return;
        }
        lastProgressCheckDist = currentDist;
      }
    }, 500);

    // SAFETY: Use physicsTick for instant fall detection (500ms interval is too slow)
    // Track BOTH per-tick drops (to catch sudden falls) AND cumulative fall distance
    // (to catch gradual acceleration off cliff edges where per-tick is small but total is huge).
    //
    // Fall threshold must match maxDropDown to avoid false positives on planned drops:
    //   Normal (Y<=90): maxDropDown=4, threshold=4
    //   High mountain (Y>90): maxDropDown=12, threshold=12
    // Bot1 Session 81 [2026-03-26]: at Y=108, mountain cliff drops are 8-12 blocks.
    // Threshold=4 fired on every planned cliff step, causing immediate abort at each attempt.
    const fallPhysicsThreshold = isHighMountainStart ? 12 : 4;
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

        // Stop if cumulative fall exceeds threshold (matched to maxDropDown to avoid false positives).
        if (totalFall > fallPhysicsThreshold) {
          console.error(`[MoveTo] PHYSICS FALL: ${totalFall.toFixed(1)} blocks cumulative (started at Y=${fallStartY.toFixed(1)}, now Y=${cy.toFixed(1)}, threshold=${fallPhysicsThreshold}). Emergency stop!`);
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
      // maxDropDown: Allow planned drops for natural terrain navigation.
      // Base value=4: Minecraft fall damage starts at >4 blocks (4-block drop = 0 damage).
      // High mountain exception (Y>90): mountain peaks have cliffs with 5-15 block drops.
      // maxDropDown=4 causes pathfinder to find no path at all from mountain peaks because
      // every adjacent cliff drop exceeds 4 blocks.
      // Bot1 Session 81 [2026-03-26]: bot at Y=108, pathfinder returned no_path in all 4
      // directions because surrounding cliff drops were 8-20 blocks (> maxDropDown=4).
      // Fix: at Y>90, allow maxDropDown=12 so pathfinder can plan mountain cliff descents.
      // The physicsTick fall detector threshold is raised to match, preventing false aborts
      // on planned drops that stay within the new limit.
      // The case1DescentLimit and absolute Y<62 floor check remain as cave routing protection.
      const effectiveMaxDropDown = isHighMountainStart ? 12 : 4;
      bot.pathfinder.movements.maxDropDown = effectiveMaxDropDown;
      bot.pathfinder.movements.allowFreeMotion = false; // Prevent cliff falls from skipped path nodes
      bot.pathfinder.movements.allow1by1towers = true; // Allow pillar up to reach higher terrain
      // Re-apply liquidCost every call — bot-core.ts sets it at init, but pathfinder
      // internals or dimension-change handlers can silently reset it. Without this,
      // pathfinder routes through rivers/water at Y=61-62, causing repeated drowned deaths.
      // Bot1 Sessions 31-34,40b,44: 6+ deaths from pathfinder choosing water-level routes.
      (bot.pathfinder.movements as any).liquidCost = 10000;

      // SAFETY: Add water and lava blocks to blocksToAvoid — liquidCost alone is not sufficient.
      // liquidCost=10000 penalizes fluid paths in cost calculations, but when the pathfinder
      // cannot find ANY land route (e.g., river between bot and target), it still uses the
      // fluid route as a fallback. blocksToAvoid makes the pathfinder treat fluids as impassable,
      // forcing it to fail (and return to the caller) instead of routing through them.
      // Bot1 [2026-03-23]: moveTo(0,72,80) routed through water at Y=114 despite liquidCost.
      // Bot1 Session 65 [2026-03-25]: flee() routed through lava underground (Y=37) — lava was
      // not in blocksToAvoid so pathfinder treated it as high-cost but passable.
      // The real-time water/lava detector in the 500ms check loop catches fluid contact eventually,
      // but blocksToAvoid prevents the pathfinder from even PLANNING a fluid route.
      const waterBlock = bot.registry.blocksByName["water"];
      const flowingWaterBlock = bot.registry.blocksByName["flowing_water"];
      if (waterBlock) bot.pathfinder.movements.blocksToAvoid.add(waterBlock.id);
      if (flowingWaterBlock) bot.pathfinder.movements.blocksToAvoid.add(flowingWaterBlock.id);
      const lavaBlock = bot.registry.blocksByName["lava"];
      const flowingLavaBlock = bot.registry.blocksByName["flowing_lava"];
      if (lavaBlock) bot.pathfinder.movements.blocksToAvoid.add(lavaBlock.id);
      if (flowingLavaBlock) bot.pathfinder.movements.blocksToAvoid.add(flowingLavaBlock.id);

      // SAFETY: Disable canDig by default to prevent cave routing.
      // Bot1 Sessions 42-44, Bot3 #17,#19: pathfinder with canDig=true digs through terrain,
      // opening cave systems where underground mobs surround the bot.
      // Previously only disabled at night or HP<10, but Bot1/Bot2/Bot3 [2026-03-22] still
      // died from daytime cave routing at HP>=10: pathfinder digs through surface blocks,
      // bot falls into cave, gets surrounded by mobs, and dies.
      // canDig provides no meaningful benefit for surface navigation — the bot has mc_tunnel
      // for intentional digging. Pathfinder digging through terrain is ALWAYS dangerous
      // because it creates unpredictable cave openings and Y-descent that bypass safety checks.
      // EXCEPTION: allowDig=true is passed when the bot is stuck with no path (e.g. cliff-edge
      // surrounded by stone blocks) as a last-resort escape via controlled dig-through.
      bot.pathfinder.movements.canDig = options?.allowDig === true ? true : false;
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
  // Use centralized isHostileMob() instead of hardcoded 6-name list.
  // Bug: previous list missed pillager, drowned, phantom, stray, husk, vindicator,
  // ravager, blaze, ghast, hoglin, piglin_brute — all of which killed bots.
  // Bot1/Bot2/Bot3 [2026-03-22]: deaths from pillagers/drowned during moveTo that
  // were not detected by the old hasHostileNearby check, allowing unsafe movement
  // (starvation deadlock exception at HP>=2 when hostiles WERE present).
  const hasHostileNearby = Object.values(bot.entities).some((e: any) => {
    if (!e || !e.position || e === bot.entity) return false;
    const dist = e.position.distanceTo(bot.entity.position);
    if (dist >= 20) return false;
    const eName = (e.name || "").toLowerCase();
    return isHostileMob(bot, eName);
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
      // Nighttime or hostile nearby WITH food available: warn but allow movement to continue.
      // Blocking here causes deadlocks — bot has food and can eat mid-travel via auto-eat.
      // Only hard-block at HP<2 (truly near-death) to prevent immediate fall death.
      if (hpNow < 2 && distance > 30) {
        return `⚠️ SAFETY: Cannot move ${distance.toFixed(1)} blocks with critical HP(${hpNow.toFixed(1)}/20) at night/hostile nearby. Risk of immediate death. Eat food first, then retry movement.`;
      }
      if (hpNow < 8 && distance > 30) {
        console.error(`[Move] WARNING: HP=${hpNow.toFixed(1)} at night/hostile nearby with food. Proceeding with caution — auto-eat will trigger during travel.`);
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
            if (block && isWaterBlock(block.name)) {
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

  // PRE-CHECK: Detect if destination is in or surrounded by water.
  // Bot1 [2026-03-23]: moveTo(0,72,80) led bot into water at Y=114 — drowned.
  // If the destination block or blocks around it are water, warn the agent.
  // Don't hard-block — the moveToBasic real-time water detector will abort if needed.
  {
    let destWaterCount = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          const checkBlock = bot.blockAt(targetPos.offset(dx, dy, dz));
          if (checkBlock && isWaterBlock(checkBlock.name)) destWaterCount++;
        }
      }
    }
    if (destWaterCount >= 3) {
      console.error(`[Move] WARNING: Destination (${x}, ${y}, ${z}) has ${destWaterCount} water blocks nearby. Risk of drowning. moveToBasic will abort if bot enters water.`);
    }
  }

  // Use pathfinder directly - it handles digging and tower building automatically
  let result = await moveToBasic(managed, x, y, z);

  // FALLBACK: If pathfinder found no path (e.g. cliff-edge surrounded by stone blocks),
  // retry with canDig=true so pathfinder can dig through obstacles as last resort.
  // Bot1 Session 57: surrounded by stone N/E/W + cliff S at Y=91, no_path with canDig=false.
  //
  // IMPORTANT: Only allow dig-fallback when bot is at surface level (Y > 60).
  // When Y <= 60, bot is underground — canDig=true generates underground routes that lead
  // back to the spawn cave system instead of the intended surface target.
  // Bot1 Session 64: allowDig=true at Y=65 (spawn cliff) generated underground path to (4,65,-3)
  // instead of the intended target (200,70,200). The underground route IS a "path" but leads
  // in the wrong direction (toward spawn's cave system, not the surface target).
  const botY = bot.entity.position.y;
  const allowDigFallback = botY > 60;
  if (!result.success && result.stuckReason === "no_path") {
    if (allowDigFallback) {
      console.error(`[Move] no_path at Y=${botY.toFixed(1)} (surface) — retrying with allowDig=true as fallback`);
      result = await moveToBasic(managed, x, y, z, { allowDig: true });
      if (result.success) {
        console.error(`[Move] Recovered via allowDig fallback`);
      }
    } else {
      console.error(`[Move] no_path at Y=${botY.toFixed(1)} (underground) — skipping allowDig fallback to avoid underground rerouting to spawn`);
    }
  }

  // FALLBACK: Manual movement escape when pathfinder cannot find any path.
  // Bot1 Sessions 58-61: bot stuck at respawn point (26.7, 86.0, -3.5) — pathfinder
  // reports no_path even with canDig=true, but place() works fine. The pathfinder
  // cannot compute a route FROM this exact cliff-edge spawn location, yet the bot's
  // physics are intact. Using setControlState(forward/jump) for 1.5s physically
  // moves the bot 2-3 blocks, breaking the pathfinder deadlock.
  // Also apply to pathfinder_stopped and obstacle — same "pathfinder gave up" symptom.
  const MANUAL_ESCAPE_REASONS = ["no_path", "pathfinder_stopped", "obstacle"];
  if (!result.success && result.stuckReason && MANUAL_ESCAPE_REASONS.includes(result.stuckReason)) {
    const preEscapePos = bot.entity.position.clone();
    console.error(`[Move] ${result.stuckReason} — attempting manual escape via setControlState (forward+jump 1.5s)`);
    try {
      // Face toward the target so forward movement heads in the right direction.
      const dx = x - preEscapePos.x;
      const dz = z - preEscapePos.z;
      const yaw = Math.atan2(-dx, dz);
      bot.look(yaw, 0, true);
      await delay(100); // Allow look to settle
      bot.setControlState("forward", true);
      bot.setControlState("jump", true);
      bot.setControlState("sprint", true);
      await delay(1500);
      bot.clearControlStates();
      await delay(300); // Allow physics to settle after clearing controls
    } catch (escapeErr) {
      console.error(`[Move] Manual escape control error: ${escapeErr}`);
      try { bot.clearControlStates(); } catch (_) {}
    }
    const postEscapePos = bot.entity.position;
    const escapedDist = postEscapePos.distanceTo(preEscapePos);
    console.error(`[Move] Manual escape moved ${escapedDist.toFixed(2)} blocks (${preEscapePos.x.toFixed(1)},${preEscapePos.y.toFixed(1)},${preEscapePos.z.toFixed(1)}) → (${postEscapePos.x.toFixed(1)},${postEscapePos.y.toFixed(1)},${postEscapePos.z.toFixed(1)})`);
    if (escapedDist >= 1.0) {
      // Bot moved — retry pathfinding from new position
      console.error(`[Move] Re-trying pathfinder after manual escape...`);
      result = await moveToBasic(managed, x, y, z);
      if (!result.success && allowDigFallback) {
        // One more attempt with allowDig — only at surface level (Y>60) to avoid underground rerouting
        result = await moveToBasic(managed, x, y, z, { allowDig: true });
      }
      if (result.success) {
        console.error(`[Move] Recovered via manual escape + pathfinder retry`);
      }
    } else {
      console.error(`[Move] Manual escape had no effect (moved ${escapedDist.toFixed(2)} blocks < 1.0). Pathfinder likely unable to compute path from this terrain.`);
    }
  }

  // POST-MOVE: If aborted due to water, ensure bot swims up and report position.
  // The moveToBasic water detector sets jump=true, but we also need to wait briefly
  // for the bot to surface before returning control to the agent.
  if (!result.success && result.stuckReason === "underwater") {
    // Wait up to 3 seconds for bot to surface (jump is already held by moveToBasic)
    for (let i = 0; i < 6; i++) {
      await delay(500);
      const surfaceCheck = bot.blockAt(bot.entity.position.offset(0, 1.6, 0).floor());
      if (!surfaceCheck || !isWaterBlock(surfaceCheck.name)) {
        // Head is above water — stop jumping
        try { bot.setControlState("jump", false); } catch (_) {}
        break;
      }
    }
    const surfacePos = bot.entity.position;
    return `${result.message} Surfaced at (${surfacePos.x.toFixed(1)}, ${surfacePos.y.toFixed(1)}, ${surfacePos.z.toFixed(1)}).` + getBriefStatus(managed);
  }

  if (result.success) {
    return result.message + getBriefStatus(managed);
  }

  // When aborted due to hostile danger checks OR underground/fall safety checks, skip
  // emergency dig — digging into terrain while surrounded by mobs or while underground
  // makes the situation worse, not better.
  // Bot1 [2026-03-25]: creeper_danger/ranged_mob_danger fallthrough caused 10+ consecutive
  // emergency-dig attempts that never moved the bot but wasted time while under attack.
  // Bot1 Session 69c [2026-03-25]: underground_routing abort fell through to emergency dig,
  // which dug in the direction of the target (100,73,100) from the underground position,
  // opening the path deeper into the cave system and the Y=58 water pocket.
  // underground_routing/fall_detected/high_route are safety aborts — the bot should
  // return to the caller immediately so the agent can choose a different strategy.
  const DANGER_ABORT_REASONS = [
    "creeper_danger", "ranged_mob_danger", "melee_mob_danger", "cliff_knockback_danger", "hp_drop",
    "underground_routing", "fall_detected", "high_route", "lava_detected",
  ];
  if (result.stuckReason && DANGER_ABORT_REASONS.includes(result.stuckReason)) {
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

  // UNDERGROUND ESCAPE AUTO-TRIGGER: Session 72c [2026-03-26]
  // Bot stuck at Y=59-73 in cave system. moveTo to surface (Y>62) fails because:
  //   1. Pathfinder cannot find horizontal route (cave walls block all paths)
  //   2. allowDig fallback is disabled at Y<=60 to prevent underground rerouting
  //   3. Manual forward+jump escape does nothing with a ceiling overhead
  // When all pathfinder attempts failed AND bot is underground (Y<62) AND target is
  // higher (surface direction), auto-trigger emergencyDigUp to dig straight up.
  // This is the only reliable escape from an enclosed cave: dig vertically to open air.
  // Condition: bot currently underground (Y<62) AND target Y is higher than current Y by >5
  // This ensures we only auto-escape when genuinely trying to go UP (surface-bound), not
  // when trying to move horizontally at cave level.
  const currentBotY = bot.entity.position.y;
  const targetIsHigher = y - currentBotY > 5;
  if (currentBotY < 62 && targetIsHigher) {
    console.error(`[Move] Underground escape: bot at Y=${currentBotY.toFixed(1)} (underground) with target Y=${y} (${(y - currentBotY).toFixed(0)} blocks up). Pathfinder failed — auto-triggering emergencyDigUp.`);
    try {
      const escapeResult = await emergencyDigUp(managed, 40);
      console.error(`[Move] emergencyDigUp result: ${escapeResult}`);
      // After digging up, retry pathfinding from new elevated position
      const postEscapeY = bot.entity.position.y;
      if (postEscapeY > currentBotY + 2) {
        console.error(`[Move] Climbed from Y=${currentBotY.toFixed(1)} to Y=${postEscapeY.toFixed(1)} — retrying pathfinder...`);
        const retryResult = await moveToBasic(managed, x, y, z);
        if (retryResult.success) {
          return `Underground escape + pathfinder: ${escapeResult} Then ${retryResult.message}` + getBriefStatus(managed);
        }
        return `Underground escape: ${escapeResult} Now at Y=${postEscapeY.toFixed(0)}, ${retryResult.message}` + getBriefStatus(managed);
      }
      return `Underground escape attempted: ${escapeResult} Position: (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)})` + getBriefStatus(managed);
    } catch (escapeErr) {
      console.error(`[Move] emergencyDigUp failed: ${escapeErr instanceof Error ? escapeErr.message : String(escapeErr)}`);
    }
  }

  let failureMsg = `Cannot reach (${x}, ${y}, ${z}). Current: (${finalPos.x.toFixed(1)}, ${finalPos.y.toFixed(1)}, ${finalPos.z.toFixed(1)}), ${finalDist.toFixed(1)} blocks away.`;

  // Give specific guidance based on the failure reason
  if (result.stuckReason === "target_higher") {
    const inv = bot.inventory.items();
    const hasScaffold = inv.some(i => ["dirt", "cobblestone", "stone", "planks"].some(b => i.name.includes(b)));
    if (currentBotY < 62) {
      // Bot is underground — escapeUnderground is the right approach
      failureMsg += ` Bot is underground (Y=${currentBotY.toFixed(0)}). Use bot.escapeUnderground() to dig straight up to surface, then retry movement.`;
    } else if (hasScaffold) {
      failureMsg += ` Target is ${heightDiff.toFixed(0)} blocks higher. Try minecraft_pillar_up to climb.`;
    } else {
      failureMsg += ` Target is ${heightDiff.toFixed(0)} blocks higher. Need blocks (dirt, cobblestone) to climb. Collect materials first.`;
    }
  } else if (result.stuckReason === "target_lower") {
    failureMsg += ` Target is ${Math.abs(heightDiff).toFixed(0)} blocks lower. Dig down or find stairs/cave entrance.`;
  } else if (currentBotY < 62) {
    // Generic failure but bot is underground — surface escape is priority
    failureMsg += ` Bot is underground (Y=${currentBotY.toFixed(0)}). Use bot.escapeUnderground() to dig straight up and escape the cave system.`;
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
  const pickaxePriority = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe"];
  let equippedPickaxe = "";
  for (const toolName of pickaxePriority) {
    const tool = bot.inventory.items().find(i => i.name === toolName);
    if (tool) { await bot.equip(tool, "hand"); equippedPickaxe = toolName; break; }
  }
  if (!equippedPickaxe) {
    const anyPickaxe = bot.inventory.items().find(i => i.name.includes("pickaxe"));
    if (anyPickaxe) { await bot.equip(anyPickaxe, "hand"); equippedPickaxe = anyPickaxe.name; }
  }

  const EMERGENCYDIG_SCAFFOLD_NAMES = new Set([
    "dirt", "coarse_dirt", "gravel", "sand", "red_sand",
    "cobblestone", "cobbled_deepslate", "stone", "granite", "diorite", "andesite",
    "deepslate", "tuff", "calcite",
    "netherrack", "basalt", "blackstone", "nether_bricks",
    "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks",
    "bamboo_planks", "crimson_planks", "warped_planks",
    "smooth_stone", "stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks",
    "bricks", "mud_bricks",
  ]);
  const EMERGENCYDIG_EXCLUDE = ["_ore", "spawner", "bedrock", "obsidian", "portal",
    "diamond_block", "emerald_block", "gold_block", "iron_block", "netherite_block",
    "ancient_debris", "crying_obsidian", "reinforced_deepslate"];
  const isScaffoldItem = (name: string) => {
    const cleanName = name.replace("minecraft:", "");
    if (EMERGENCYDIG_EXCLUDE.some(p => cleanName.includes(p))) return false;
    // Fast path: explicit allowlist (avoids registry lookup failures)
    if (EMERGENCYDIG_SCAFFOLD_NAMES.has(cleanName)) return true;
    // Fallback: registry check
    try {
      const blockInfo = bot.registry?.blocksByName?.[cleanName];
      return !!(blockInfo && blockInfo.boundingBox === "block");
    } catch {
      return false;
    }
  };

  const digBlock = async (pos: Vec3): Promise<boolean> => {
    const block = bot.blockAt(pos);
    if (!block || block.name === "air" || block.name === "cave_air" || block.name === "void_air") return true;
    if (block.hardness < 0) return false;
    if (equippedPickaxe) {
      const pick = bot.inventory.items().find(i => i.name === equippedPickaxe);
      if (pick) await bot.equip(pick, "hand");
    }
    try {
      await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
      // Timeout: bot.dig() waits for diggingCompleted event which can hang if the server
      // doesn't respond (e.g., unreachable block, look angle mismatch, server lag).
      await Promise.race([
        bot.dig(block, false),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("dig timeout")), 5000)),
      ]);
      return true;
    } catch (e) {
      try { bot.stopDigging(); } catch { /* ignore */ }
      return false;
    }
  };

  let blocksDug = 0;
  let blocksClimbed = 0;

  // Bot1 Session 64 [2026-03-25]: emergencyDigUp only dug blocks but never moved the bot
  // upward — it broke Y+1, Y+2... but the bot stayed at startY because there was no
  // jump/climb mechanism. In enclosed caves, the bot needs to both dig AND ascend.
  // Strategy: dig Y+1 and Y+2 for head clearance, then jump-place scaffold to gain +1Y.
  // If no scaffold, dig only (creates a shaft but bot cannot ascend without scaffold).
  for (let i = 0; i < maxBlocks; i++) {
    const curX = Math.floor(bot.entity.position.x);
    const curY = Math.floor(bot.entity.position.y);
    const curZ = Math.floor(bot.entity.position.z);

    // Check if we've reached a surface-like area (open sky above)
    let openAbove = true;
    for (let checkDy = 1; checkDy <= 4; checkDy++) {
      const b = bot.blockAt(new Vec3(curX, curY + checkDy, curZ));
      if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "void_air") {
        openAbove = false;
        break;
      }
    }
    if (openAbove && curY >= startY + 5) {
      console.error(`[EmergencyDigUp] Reached open area at Y=${curY}, climbed ${blocksClimbed} blocks`);
      return `Emergency escape: dug ${blocksDug} blocks, climbed ${blocksClimbed} blocks. Now at Y=${curY}.`;
    }

    // Dig Y+1 and Y+2 for head clearance before jump
    const digPos1 = new Vec3(curX, curY + 1, curZ);
    const digPos2 = new Vec3(curX, curY + 2, curZ);
    const cleared1 = await digBlock(digPos1);
    if (!cleared1) {
      return `Hit unbreakable block at Y=${curY + 1} after digging ${blocksDug} blocks. Cannot escape upward.`;
    }
    const block1Before = bot.blockAt(digPos1);
    if (block1Before && block1Before.name !== "air" && block1Before.name !== "cave_air") blocksDug++;
    const cleared2 = await digBlock(digPos2);
    if (!cleared2) {
      return `Hit unbreakable block at Y=${curY + 2} after digging ${blocksDug} blocks.`;
    }
    const block2Before = bot.blockAt(digPos2);
    if (block2Before && block2Before.name !== "air" && block2Before.name !== "cave_air") blocksDug++;

    await delay(100);

    // Attempt to jump and place scaffold to gain +1 Y
    const scaffold = bot.inventory.items().find(i => isScaffoldItem(i.name));
    if (scaffold) {
      try {
        await bot.equip(scaffold, "hand");
        // Look down at the block we're standing on
        const standingBlock = bot.blockAt(new Vec3(curX, curY - 1, curZ))
          || bot.blockAt(new Vec3(curX, curY, curZ));
        if (standingBlock && standingBlock.name !== "air" && standingBlock.name !== "cave_air") {
          const jumpBaseY = bot.entity.position.y;
          bot.setControlState("jump", true);
          // Wait for jump apex
          let jumpedEnough = false;
          await new Promise<void>((resolve) => {
            let elapsed = 0;
            const iv = setInterval(() => {
              elapsed += 10;
              if (bot.entity.position.y - jumpBaseY >= 0.4) { jumpedEnough = true; clearInterval(iv); resolve(); }
              else if (elapsed >= 600) { clearInterval(iv); resolve(); }
            }, 10);
          });
          bot.setControlState("jump", false);
          if (jumpedEnough) {
            try {
              await bot.placeBlock(standingBlock, new Vec3(0, 1, 0));
              await delay(400);
              const newY = Math.floor(bot.entity.position.y);
              if (newY > curY) {
                blocksClimbed += newY - curY;
                console.error(`[EmergencyDigUp] Climbed: Y ${curY} → ${newY}`);
              } else {
                console.error(`[EmergencyDigUp] Jump-place succeeded but Y didn't change (${curY})`);
              }
            } catch (placeErr) {
              console.error(`[EmergencyDigUp] Place failed: ${placeErr}`);
              await delay(300);
            }
          } else {
            // Jump failed — head still blocked? Try dig again and wait
            console.error(`[EmergencyDigUp] Jump too low at Y=${curY}, re-digging Y+1`);
            await digBlock(new Vec3(curX, curY + 1, curZ));
            await delay(300);
          }
        }
      } catch (err) {
        console.error(`[EmergencyDigUp] Jump-place error: ${err}`);
      }
    } else {
      // No scaffold in inventory yet. Dig Y+1 and Y+2 — digging stone/dirt adds cobblestone/dirt
      // to inventory, which can then be used as scaffold. After digging 2 blocks, re-check inventory.
      // Session 72c [2026-03-26]: old "dig-only mode" dug a shaft but never re-checked inventory
      // for newly acquired scaffold from the dug blocks, so the bot could never ascend.
      console.error(`[EmergencyDigUp] No scaffold in inventory — digging Y+1/Y+2 to acquire blocks...`);
      const digPos1NoScaff = new Vec3(curX, curY + 1, curZ);
      const digPos2NoScaff = new Vec3(curX, curY + 2, curZ);
      const cleared1NoScaff = await digBlock(digPos1NoScaff);
      if (cleared1NoScaff) blocksDug++;
      const cleared2NoScaff = await digBlock(digPos2NoScaff);
      if (cleared2NoScaff) blocksDug++;
      await delay(300); // Wait for item pickup
      // Re-check inventory for newly acquired scaffold blocks
      const newScaffold = bot.inventory.items().find(i => isScaffoldItem(i.name));
      if (newScaffold) {
        console.error(`[EmergencyDigUp] Acquired scaffold (${newScaffold.name}) from digging — switching to climb mode`);
        // Continue main loop iteration (scaffold now available, loop will use it next iteration)
        continue;
      }
      // Still no scaffold — dig remaining shaft blocks in one pass then return
      console.error(`[EmergencyDigUp] No scaffold after digging — opening shaft upward (dig-only mode)`);
      for (let dy = 3; dy <= maxBlocks - i; dy++) {
        const block = bot.blockAt(new Vec3(curX, curY + dy, curZ));
        if (!block || block.name === "air" || block.name === "cave_air") continue;
        if (block.hardness < 0) break;
        try {
          await bot.lookAt(new Vec3(curX + 0.5, curY + dy + 0.5, curZ + 0.5), true);
          if (equippedPickaxe) {
            const pick = bot.inventory.items().find(i => i.name === equippedPickaxe);
            if (pick) await bot.equip(pick, "hand");
          }
          await Promise.race([
            bot.dig(block, false),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("dig timeout")), 5000)),
          ]);
          blocksDug++;
          // Check for scaffold after each dig — stone gives cobblestone
          const scaffoldCheck = bot.inventory.items().find(i => isScaffoldItem(i.name));
          if (scaffoldCheck) {
            console.error(`[EmergencyDigUp] Acquired scaffold (${scaffoldCheck.name}) mid-shaft — breaking to climb mode`);
            // Break out of the shaft-dig loop and let the main loop handle climbing
            break;
          }
        } catch { try { bot.stopDigging(); } catch { /* ignore */ } }
      }
      // If we now have scaffold, the main loop will continue and climb
      const scaffoldAfterShaft = bot.inventory.items().find(i => isScaffoldItem(i.name));
      if (!scaffoldAfterShaft) {
        return `No scaffold blocks available — dug ${blocksDug} shaft blocks upward from Y=${startY}. Inventory has no suitable climbing blocks. Use bot.pillarUp() after gathering cobblestone/dirt to climb out.`;
      }
      // Otherwise continue the main loop to climb
    }

    // Check if bot fell - if so, wait and restart
    if (Math.floor(bot.entity.position.y) < curY - 2) {
      console.error(`[EmergencyDigUp] Bot fell, waiting to land...`);
      await delay(1000);
    }
  }

  return `Emergency dig: dug ${blocksDug} blocks, climbed ${blocksClimbed} blocks. Now at Y=${Math.floor(bot.entity.position.y)}.`;
}

/**
 * Pillar up by jump-placing blocks
 */
export async function pillarUp(managed: ManagedBot, height: number = 1, untilSky: boolean = false, _ignoreThreats: boolean = false): Promise<string> {
  const bot = managed.bot;
  const startY = bot.entity.position.y;

  // Global timeout: pillarUp should never exceed 45s.
  // Bot1/Bot2 [2026-03-23]: pillarUp timed out at 60s+ when jump-place repeatedly
  // failed but didn't break (e.g., insufficient rise, drift off pillar, server lag).
  // Each level can take up to 3 attempts * (600ms jump + 500ms settle + 300ms retry) = ~4.2s,
  // and targetHeight can be up to 15 or 50 (untilSky). Without a global timeout,
  // the function hangs indefinitely while the bot is stationary and exposed to mobs.
  const PILLAR_TIMEOUT_MS = 45000;
  const pillarStartTime = Date.now();

  // THREAT DETECTION: Bot1 Session 55 - zombie approached during pillarUp, leaving bot vulnerable.
  // Check for nearby melee threats at start. If zombie/spider within 4 blocks, abort and suggest
  // flee first before pillaring. Also check during placement loop to abort if threat gets closer.
  const checkThreatsForPillar = (): { threat: any; distance: number } | null => {
    const hostiles = Object.values(bot.entities).filter((e: any) => {
      if (!e || !e.name) return false;
      const name = e.name.toLowerCase();
      return ["zombie", "zombie_villager", "drowned", "husk", "spider", "cave_spider", "warden"]
        .some(m => name.includes(m));
    });
    if (hostiles.length === 0) return null;
    const closest = hostiles.reduce((prev: any, curr: any) => {
      const prevDist = bot.entity.position.distanceTo(prev.position);
      const currDist = bot.entity.position.distanceTo(curr.position);
      return currDist < prevDist ? curr : prev;
    });
    const dist = bot.entity.position.distanceTo(closest.position);
    if (dist < 4.0) {
      return { threat: closest, distance: dist };
    }
    return null;
  };

  // Quick scaffold count check for threat message (uses explicit allowlist for reliability)
  const QUICK_SCAFFOLD_NAMES = new Set([
    "dirt", "coarse_dirt", "gravel", "sand", "red_sand",
    "cobblestone", "cobbled_deepslate", "stone", "granite", "diorite", "andesite",
    "deepslate", "tuff", "calcite", "netherrack", "basalt", "blackstone",
    "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks",
    "bamboo_planks", "crimson_planks", "warped_planks",
    "smooth_stone", "stone_bricks", "bricks", "nether_bricks", "mud_bricks",
  ]);
  const quickScaffoldCount = bot.inventory.items()
    .filter(i => QUICK_SCAFFOLD_NAMES.has(i.name.replace("minecraft:", "")))
    .reduce((sum, i) => sum + i.count, 0);

  const estimatedTime = Math.ceil((untilSky ? Math.min(quickScaffoldCount, 50) : Math.min(height, 15)) * 4.2 / 1000);

  // THREAT CHECK: Abort if melee threats within 4 blocks
  // Bot1 Session 55: Zombie at 14.9 blocks approached to melee range during pillarUp
  // execution (19s window), killing bot while placement was failing. Early abort prevents
  // prolonged exposure to enemies.
  // EXCEPTION: When called from flee() with _ignoreThreats=true, skip this check.
  // flee() pre-pillar is a DEFENSIVE move when already surrounded — aborting it would
  // leave the bot on the ground in melee range, which is strictly worse.
  const initialThreat = checkThreatsForPillar();
  if (initialThreat && !_ignoreThreats) {
    const msg = `Melee threat (${initialThreat.threat.name}) detected ${initialThreat.distance.toFixed(1)} blocks away. pillarUp will expose bot for ~${estimatedTime}s. Use mc_flee first, then pillarUp. Current HP=${bot.health?.toFixed(1) ?? '?'}${getBriefStatus(managed)}`;
    console.error(`[Pillar] ${msg}`);
    return msg;
  }
  if (initialThreat && _ignoreThreats) {
    console.error(`[Pillar] Melee threat nearby (${initialThreat.threat.name} at ${initialThreat.distance.toFixed(1)}m) but ignoring — emergency pillar from flee().`);
  }

  // SAFETY: Detect if bot is currently IN water — pillarUp cannot work in water.
  // Bot1 Session 38: pillarUp timed out at Y=44 underwater — jump-place doesn't work
  // in water because the bot floats and can't get stable footing on the placed block.
  // Instead of silently failing, detect water and attempt emergency swim-up.
  {
    const feetPos = bot.entity.position.floor();
    const feetBlock = bot.blockAt(feetPos);
    const headBlock = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
    const isInWater = (feetBlock && isWaterBlock(feetBlock.name)) ||
                      (headBlock && isWaterBlock(headBlock.name));
    if (isInWater) {
      console.error(`[Pillar] Bot is IN WATER at (${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}). PillarUp won't work — attempting emergency swim-up.`);
      // Hold jump to swim upward for up to 8 seconds
      bot.setControlState("jump", true);
      let surfaced = false;
      for (let i = 0; i < 16; i++) {
        await delay(500);
        const checkFeet = bot.blockAt(bot.entity.position.floor());
        const checkHead = bot.blockAt(bot.entity.position.offset(0, 1, 0).floor());
        if ((!checkFeet || !isWaterBlock(checkFeet.name)) && (!checkHead || !isWaterBlock(checkHead.name))) {
          surfaced = true;
          break;
        }
      }
      bot.setControlState("jump", false);
      const newPos = bot.entity.position;
      if (surfaced) {
        return `Cannot pillarUp in water — swam up instead. Now at (${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)}) on surface. Retry pillarUp if needed.${getBriefStatus(managed)}`;
      } else {
        return `Cannot pillarUp in water. Attempted swim-up but still in water at (${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)}). Try bot.navigate() to find land, or dig sideways to escape water.${getBriefStatus(managed)}`;
      }
    }
  }

  // Check if we have scaffolding blocks.
  // IMPORTANT: Use an explicit allowlist as primary check to avoid registry lookup failures.
  // Previous approach relied solely on bot.registry.blocksByName[name].boundingBox === 'block',
  // which can silently fail if the registry entry is missing or the version mapping differs.
  // Session report: bot had dirt:99 but isScaffoldBlock returned false — registry-only check
  // missed items that are definitively valid scaffold blocks.
  // Fix: explicit allowlist for common scaffold blocks (never fails), registry as fallback.
  const KNOWN_SCAFFOLD_NAMES = new Set([
    "dirt", "coarse_dirt", "gravel", "sand", "red_sand",
    "cobblestone", "cobbled_deepslate", "stone", "granite", "diorite", "andesite",
    "deepslate", "tuff", "calcite",
    "netherrack", "basalt", "blackstone", "nether_bricks",
    "oak_planks", "spruce_planks", "birch_planks", "jungle_planks",
    "acacia_planks", "dark_oak_planks", "mangrove_planks", "cherry_planks",
    "bamboo_planks", "crimson_planks", "warped_planks",
    "smooth_stone", "stone_bricks", "mossy_stone_bricks", "cracked_stone_bricks",
    "bricks", "mud_bricks",
  ]);
  const SCAFFOLD_EXCLUDE_PATTERNS = ["_ore", "spawner", "bedrock", "obsidian", "portal",
    "diamond_block", "emerald_block", "gold_block", "iron_block", "netherite_block",
    "ancient_debris", "crying_obsidian", "reinforced_deepslate"];

  const isScaffoldBlock = (itemName: string): boolean => {
    // Remove minecraft: prefix if present
    const cleanName = itemName.replace("minecraft:", "");
    // Exclude valuable/special blocks
    if (SCAFFOLD_EXCLUDE_PATTERNS.some(p => cleanName.includes(p))) return false;
    // Fast path: known scaffold block names (always valid, no registry lookup needed)
    if (KNOWN_SCAFFOLD_NAMES.has(cleanName)) return true;
    // Fallback: registry lookup for other solid blocks
    try {
      const blockInfo = bot.registry?.blocksByName?.[cleanName];
      if (!blockInfo) return false;
      return blockInfo.boundingBox === "block";
    } catch {
      return false;
    }
  };

  const countScaffold = () => bot.inventory.items()
    .filter(i => isScaffoldBlock(i.name))
    .reduce((sum, i) => sum + i.count, 0);

  const scaffoldCount = countScaffold();

  if (scaffoldCount === 0) {
    const inv = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ") || "empty";
    throw new Error(`Cannot pillar up - no scaffold blocks! Need: cobblestone, dirt, stone. Have: ${inv}`);
  }

  // UNDERGROUND CEILING DETECTION: Session 66 [2026-03-25], Session 79 [2026-03-26]
  // At Y=56 underground surrounded by mobs, pillarUp burned 45s on repeated 5s dig timeouts
  // against a stone ceiling without making any Y progress.
  // If the bot is underground (Y<70) and there is ANY solid block directly above,
  // skip the jump-place loop entirely and use emergencyDigUp().
  // Root cause of Session 79 failure: bot at Y=52 with cobblestone 96 in cave with ceiling
  // only 1-3 blocks above. Old threshold (>= 4 consecutive solid blocks) was too high —
  // a cave with 3 solid blocks of ceiling (which is the NORMAL case) would fall through to
  // the jump-place loop, which cannot work in an enclosed cave because:
  //   1. The dig-above phase clears Y+1/+2/+3 — then there's no roof for reference block
  //   2. _placeBlockWithOptions times out 3 times → consecutiveFailures=3 → abort
  //   3. Result: "No blocks placed" despite having 96 cobblestone
  // Fix: ANY solid block above at Y<70 → use emergencyDigUp() which digs+climbs properly.
  {
    const botYForCheck = Math.floor(bot.entity.position.y);
    const botXForCheck = Math.floor(bot.entity.position.x);
    const botZForCheck = Math.floor(bot.entity.position.z);
    if (botYForCheck < 70) {
      const blockDirectlyAbove = bot.blockAt(new Vec3(botXForCheck, botYForCheck + 1, botZForCheck));
      const blockAbove2 = bot.blockAt(new Vec3(botXForCheck, botYForCheck + 2, botZForCheck));
      // Count consecutive solid blocks to distinguish open cave (0-1 solid) from enclosed (2+)
      let consecutiveSolidAbove = 0;
      for (let checkDy = 1; checkDy <= 6; checkDy++) {
        const b = bot.blockAt(new Vec3(botXForCheck, botYForCheck + checkDy, botZForCheck));
        if (b && b.name !== "air" && b.name !== "cave_air" && b.name !== "void_air" && !isWaterBlock(b.name)) {
          consecutiveSolidAbove++;
        } else {
          break;
        }
      }
      // Use emergencyDigUp if there's a solid ceiling (1+ consecutive solid blocks directly above)
      // This covers all cave scenarios: low ceiling (1-2 blocks), medium ceiling (3 blocks),
      // and thick ceiling (4+ blocks). The old threshold of 4 missed the most common cave shapes.
      const hasSolidCeiling = consecutiveSolidAbove >= 1;
      // Exception: if we're at the very surface (block above is sky/open air at most 2 blocks up),
      // keep the jump-place approach which works well on open terrain.
      const isOpenAbove = (!blockDirectlyAbove || blockDirectlyAbove.name === "air" || blockDirectlyAbove.name === "cave_air" || blockDirectlyAbove.name === "void_air") &&
                          (!blockAbove2 || blockAbove2.name === "air" || blockAbove2.name === "cave_air" || blockAbove2.name === "void_air");
      if (hasSolidCeiling && !isOpenAbove) {
        console.error(`[Pillar] Underground (Y=${botYForCheck}) with ${consecutiveSolidAbove} solid block(s) above (ceiling at Y+1=${blockDirectlyAbove?.name ?? 'null'}). Using emergencyDigUp() to escape cave.`);
        bot.setControlState("sneak", false);
        return emergencyDigUp(managed, 30);
      }
    }
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
  let consecutiveFailures = 0; // Track failed placement attempts — if 3 in a row, abort

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
    // Periodic threat check during pillarUp loop (every iteration after first few)
    // Bot1 Session 55: Threat detection should happen during placement, not just at start
    if (i > 0 && i % 2 === 0) {
      const runtimeThreat = checkThreatsForPillar();
      if (runtimeThreat) {
        const gained = bot.entity.position.y - startY;
        bot.setControlState("sneak", false);
        console.error(`[Pillar] THREAT ABORT: ${runtimeThreat.threat.name} at ${runtimeThreat.distance.toFixed(1)}m during placement (level ${i + 1}/${targetHeight})`);
        return `Pillared up ${gained.toFixed(1)} blocks (Y:${startY.toFixed(0)}→${bot.entity.position.y.toFixed(0)}, placed ${blocksPlaced}/${targetHeight}). ABORTED: Melee threat (${runtimeThreat.threat.name} at ${runtimeThreat.distance.toFixed(1)}m) detected — flee or combat first.${getBriefStatus(managed)}`;
      }
    }

    // Global timeout check: abort if pillarUp has been running too long.
    // Bot1/Bot2 [2026-03-23]: pillarUp exceeded 60s when placement repeatedly failed,
    // leaving bot stationary and exposed to mobs for the entire duration.
    if (Date.now() - pillarStartTime > PILLAR_TIMEOUT_MS) {
      const gained = bot.entity.position.y - startY;
      console.error(`[Pillar] TIMEOUT after ${PILLAR_TIMEOUT_MS / 1000}s. Placed ${blocksPlaced}/${targetHeight}, gained ${gained.toFixed(1)} blocks.`);
      bot.setControlState("sneak", false);
      return `Pillared up ${gained.toFixed(1)} blocks (placed ${blocksPlaced}/${targetHeight}). TIMEOUT after ${PILLAR_TIMEOUT_MS / 1000}s — placement was too slow. Current Y=${bot.entity.position.y.toFixed(0)}.${getBriefStatus(managed)}`;
    }

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
    // Bot1 Session [2026-03-24]: reached water surface (Y=56) and continued pillaring,
    // got pushed into the water body by the placed blocks and drowned.
    // Check Y+1 (head) and Y+2 (above head) for water. If either is water, stop.
    // ALSO check Y (feet) and Y-1 (below) — if we're in water, abort immediately.
    // This catches the case where pillarUp places blocks that push the bot into water.
    {
      let inWater = false;
      const feetBlock = bot.blockAt(new Vec3(curX, currentY, curZ));
      if (feetBlock && isWaterBlock(feetBlock.name)) {
        inWater = true;
        console.error(`[Pillar] BOT IS IN WATER at Y=${currentY} (${feetBlock.name}). Drowning risk — aborting.`);
      }

      for (const yOff of [1, 2]) {
        const waterCheck = bot.blockAt(new Vec3(curX, currentY + yOff, curZ));
        if (waterCheck && isWaterBlock(waterCheck.name)) {
          inWater = true;
          console.error(`[Pillar] WATER detected at Y=${currentY + yOff} (${waterCheck.name}). Drowning risk — aborting.`);
          break;
        }
      }

      if (inWater) {
        bot.setControlState("sneak", false);
        const gained = bot.entity.position.y - startY;
        return `Pillared up ${gained.toFixed(1)} blocks (placed ${blocksPlaced}/${targetHeight}). STOPPED: Water detected — drowning risk. Current Y=${currentY}. Move away from water and try again, or use bot.mc_navigate() to reach land.${getBriefStatus(managed)}`;
      }
    }

    // 1. Dig blocks above if needed (Y+1, Y+2, Y+3 for head/jump clearance)
    // Bot1/Bot3 [2026-03-22]: pillarUp repeatedly failed with "Placement failed" after
    // only 1 block because it only checked Y+2 and Y+3, missing a block at Y+1 (head level).
    // In tight caves, a block at Y+1 prevents the jump from starting entirely — the bot
    // rises only 0.1-0.2 blocks (below the 0.5 threshold), causing placement to fail.
    // Now also dig Y+1 to ensure head clearance before jump.
    //
    // Bot1 Session 65 [2026-03-25]: pillarUp(3) timed out at 30s in a Y=62 cave with 126
    // cobblestone. Root cause: bot.dig(blockAbove) has NO timeout — mineflayer's dig()
    // waits for diggingCompleted/diggingAborted events, which may never fire in tight caves
    // (e.g., server drops the packet, block is unreachable due to look angle, or bot is
    // slightly out of range). A single hanging dig blocks the entire pillarUp loop.
    // Fix: wrap bot.dig() with Promise.race and a 5s per-block timeout.
    for (const yOffset of [1, 2, 3]) {
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
          // Look at the block before digging — mineflayer's dig() requires the bot to
          // face the block or it may silently fail / not fire diggingCompleted.
          await bot.lookAt(blockAbove.position.offset(0.5, 0.5, 0.5), true);
          // Timeout: if dig() hangs (no event), abort after 5s and continue anyway.
          await Promise.race([
            bot.dig(blockAbove),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("dig timeout")), 5000)),
          ]);
        } catch (e) {
          console.error(`[Pillar] Dig failed at Y+${yOffset}: ${e}`);
          try { bot.stopDigging(); } catch { /* ignore */ }
          // Continue anyway - might be able to proceed
        }
      }
    }

    // 2. Equip scaffold block
    // Bot1 Session 54-55: equip() sometimes fails silently, leaving non-scaffold item in hand.
    // Fix: loop through ALL scaffold blocks until one is successfully held.
    const scaffolds = bot.inventory.items().filter(i => isScaffoldBlock(i.name));
    if (scaffolds.length === 0) {
      console.error(`[Pillar] Out of blocks after ${blocksPlaced} placed`);
      break;
    }

    let equipSuccess = false;
    for (const candidateScaffold of scaffolds) {
      try {
        console.error(`[Pillar] Attempting to equip: ${candidateScaffold.name} x${candidateScaffold.count} (slot ${candidateScaffold.slot})`);
        await bot.equip(candidateScaffold, "hand");

        // Verify the held item after equip.
        // Primary check: isScaffoldBlock on held item name.
        // Fallback: if equip() didn't throw and held item type matches what we equipped, trust it.
        // (bot.heldItem can be null or stale in rare race conditions, but equip() success is authoritative.)
        const held = bot.heldItem;
        const heldIsScaffold = held && isScaffoldBlock(held.name);
        const heldMatchesEquipped = held && held.type === candidateScaffold.type;
        if (heldIsScaffold || heldMatchesEquipped) {
          console.error(`[Pillar] Successfully equipped ${held?.name ?? candidateScaffold.name} (verified: scaffold=${heldIsScaffold}, typeMatch=${heldMatchesEquipped})`);
          equipSuccess = true;
          break;
        } else {
          console.error(`[Pillar] Equip failed verification: held=${held?.name ?? 'null'} (type=${held?.type ?? 'null'}), expected ${candidateScaffold.name} (type=${candidateScaffold.type})`);
        }
      } catch (equipErr) {
        console.error(`[Pillar] equip(${candidateScaffold.name}) threw: ${equipErr}`);
      }
    }

    if (!equipSuccess) {
      console.error(`[Pillar] Failed to equip any scaffold block at level ${i + 1}, breaking`);
      break;
    }

    // 3. Get block below feet to place against
    // Use the locked pillar column as primary candidate — this is where we've been
    // placing blocks. Fall back to actual position if pillar column is air.
    const feetY = Math.floor(bot.entity.position.y);
    const bx = Math.floor(bot.entity.position.x);
    const bz = Math.floor(bot.entity.position.z);
    // Bot1 [2026-03-24]: pillarUp "No blocks placed" on birch forest at Y=78 with 81 dirt.
    // Root cause: on uneven terrain, position.y may be exactly at an integer (e.g. 78.0),
    // making feetY=78 and the block the bot stands ON is at Y=78, not Y=77.
    // Old candidates only checked feetY-1 and feetY-2, missing feetY itself.
    // Fix: also check feetY (the block at the exact feet position) as a higher-priority candidate.
    const candidates = [
      new Vec3(pillarX, feetY - 1, pillarZ),  // Pillar column (most reliable)
      new Vec3(bx, feetY - 1, bz),            // Actual position
      new Vec3(pillarX, feetY, pillarZ),       // Pillar column at feet (sloped terrain fix)
      new Vec3(bx, feetY, bz),                // Actual position at feet (sloped terrain fix)
      new Vec3(pillarX, feetY - 2, pillarZ),   // Pillar column -2
      new Vec3(bx, feetY - 2, bz),            // Actual position -2
    ];
    let blockBelow: ReturnType<typeof bot.blockAt> = null;
    console.error(`[Pillar] Looking for block below: pos=(${bot.entity.position.x.toFixed(2)}, ${bot.entity.position.y.toFixed(2)}, ${bot.entity.position.z.toFixed(2)}), feetY=${feetY}, bx=${bx}, bz=${bz}, curX=${curX}, curZ=${curZ}`);
    for (const pos of candidates) {
      const b = bot.blockAt(pos);
      console.error(`[Pillar]   candidate (${pos.x},${pos.y},${pos.z}): ${b?.name ?? "null"} bb=${(b as any)?.boundingBox ?? "?"}`);
      if (b && b.name !== "air" && b.name !== "cave_air" && !isWaterBlock(b.name) && b.name !== "void_air") {
        blockBelow = b;
        break;
      }
    }
    if (!blockBelow) {
      // Last-resort fallback: if no block found via floor(), try raw Y scan from feet down.
      // This handles sub-pixel positions like 78.01 where Math.floor gives 78 but bot stands on 77.
      console.error(`[Pillar] No block below via candidates — scanning Y range [${feetY - 3}, ${feetY + 1}]...`);
      for (let scanY = feetY + 1; scanY >= feetY - 3; scanY--) {
        const b = bot.blockAt(new Vec3(pillarX, scanY, pillarZ));
        if (b && b.name !== "air" && b.name !== "cave_air" && !isWaterBlock(b.name) && b.name !== "void_air") {
          console.error(`[Pillar] Found block via scan: ${b.name} at Y=${scanY}`);
          blockBelow = b;
          break;
        }
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
          if (b && b.name !== "air" && b.name !== "cave_air" && !isWaterBlock(b.name) && b.name !== "void_air") {
            blockBelow = b;
            break;
          }
        }
        if (!blockBelow) break;
        await new Promise(r => setTimeout(r, 200));
      }

      // Look at the top face of the block we'll place on BEFORE jumping.
      // We use forceLook:true (synchronous) inside _placeBlockWithOptions rather than
      // forceLook:'ignore', because modern Minecraft servers (1.19+) validate that the
      // player's look direction matches the cursor position in the block_place packet.
      // forceLook:'ignore' caused "No block has been placed" — server rejected because
      // the bot's look direction (arbitrary) didn't match cursor dy=1.0 (top face).
      // Bot1 [2026-03-24]: Both _placeBlockWithOptions('ignore') and bot.placeBlock fallback
      // each waited 5 seconds for a blockUpdate that never came, totaling ~30s per attempt.
      const preJumpBlock = blockBelow!;
      // Pre-aim at the top-face center of the reference block so the look is approximate
      // before jumping. The forceLook:true in _placeBlockWithOptions will fine-tune it.
      const lookTarget = preJumpBlock.position.offset(0.5, 1, 0.5);
      await bot.lookAt(lookTarget, true);
      await new Promise(r => setTimeout(r, 100)); // Brief settle after look

      // Save reference block position before jumping
      const savedBlockPos = preJumpBlock.position.clone();

      const jumpBaseY = bot.entity.position.y;
      // Temporarily release sneak before jumping.
      // In some server configurations and mineflayer physics, sneak suppresses jump velocity,
      // causing jumpOk to never reach 0.5 blocks (especially on uneven mountain terrain at Y>90).
      // Bot1 Session 82 [2026-03-26]: pillarUp failed with "No blocks placed" at Y=109 mountain
      // peak despite cobblestone×138 — root cause was sneak preventing jump from reaching 0.5 block
      // threshold (jumpOk=false every attempt → 3 consecutive failures → abort).
      // Fix: release sneak for the jump window, then re-enable after placement to prevent drift.
      bot.setControlState("sneak", false);
      await new Promise(r => setTimeout(r, 50)); // Brief settle after sneak release
      bot.setControlState("jump", true);

      // Wait until we've risen enough (>= 0.5 blocks).
      let jumpOk = false;
      await new Promise<void>((resolve) => {
        let elapsed = 0;
        const interval = setInterval(() => {
          elapsed += 10;
          const rising = bot.entity.position.y - jumpBaseY;
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
      // Re-enable sneak after jump to prevent edge drift during placement
      bot.setControlState("sneak", true);

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

          // Place on top of block below using forceLook:true (synchronous look).
          // forceLook:true makes mineflayer look at the reference face synchronously
          // (no round-trip wait) before sending the block_place packet. This satisfies
          // modern server validation that checks look direction matches cursor position.
          // Bot1 [2026-03-24] Session 54: forceLook:'ignore' caused all placements to
          // be silently rejected by server — server expected look direction to match
          // cursor dy=1.0 (top face). Using forceLook:true fixes this.
          console.error(`[Pillar] Placing on ${freshBlock!.name} at (${freshBlock!.position.x},${freshBlock!.position.y},${freshBlock!.position.z}), held=${bot.heldItem?.name ?? 'null'}`);
          // Timeout wrapper: _placeBlockWithOptions waits for blockUpdate event which may
          // never fire (server lag, packet drop, look angle mismatch). Without a timeout,
          // a single hung placement blocks the entire pillarUp loop for the rest of the
          // 45s global timer, resulting in 0 Y gain despite successful jump.
          // Session 71c [2026-03-26]: pillarUp(8) returned Y unchanged because
          // _placeBlockWithOptions hung indefinitely on first attempt.
          await Promise.race([
            (bot as any)._placeBlockWithOptions(freshBlock!, new Vec3(0, 1, 0), { forceLook: true, swingArm: 'right' }),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("placeBlock timeout 3s")), 3000)),
          ]);
          blocksPlaced++;
          placed = true;
          console.error(`[Pillar] Placed ${blocksPlaced}/${targetHeight} at Y=${currentY}`);
        } catch (e) {
          console.error(`[Pillar] Place failed (attempt ${attempt + 1}): ${e}`);
          await new Promise(r => setTimeout(r, 300));
        }
      } else {
        // Jump didn't reach 0.5 blocks. Common causes:
        // 1. Block at Y+1 (head level) prevents jump start — already dug above, but block
        //    may have regenerated (e.g., flowing water) or the dig failed silently.
        // 2. Bot is not on solid ground (floating/sliding) — sneak drift.
        // 3. Server lag causing position updates to be delayed.
        const jumpRise = bot.entity.position.y - jumpBaseY;
        const headBlockCheck = bot.blockAt(new Vec3(pillarX, currentY + 1, pillarZ));
        const headName = headBlockCheck?.name ?? "null";
        console.error(`[Pillar] Jump too low (rise=${jumpRise.toFixed(2)}, head_block=${headName}), attempt ${attempt + 1}/3`);
        // If head is blocked (not air/cave_air), try digging it again before next attempt.
        // The earlier dig loop (line 1378) may have failed silently or the block regenerated.
        if (headBlockCheck && headBlockCheck.name !== "air" && headBlockCheck.name !== "cave_air"
            && headBlockCheck.name !== "void_air" && !isWaterBlock(headBlockCheck.name)) {
          console.error(`[Pillar] Head blocked by ${headName} at Y=${currentY + 1} — re-digging before retry`);
          try {
            const pick = bot.inventory.items().find(i => i.name.includes("pickaxe"));
            if (pick) await bot.equip(pick, "hand");
            await bot.lookAt(headBlockCheck.position.offset(0.5, 0.5, 0.5), true);
            await Promise.race([
              bot.dig(headBlockCheck),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("dig timeout")), 5000)),
            ]);
            // Re-equip scaffold for the next placement attempt
            const scaffoldReEquip = bot.inventory.items().find(i => isScaffoldBlock(i.name));
            if (scaffoldReEquip) await bot.equip(scaffoldReEquip, "hand");
          } catch (redigErr) {
            console.error(`[Pillar] Re-dig failed: ${redigErr}`);
          }
        }
        await new Promise(r => setTimeout(r, 300));
      }

      // Wait to land on the new block (sneak stays on to prevent drift)
      await new Promise(r => setTimeout(r, 500));
    }

    if (!placed) {
      console.error(`[Pillar] Failed to place block after 3 attempts at level ${i + 1} — trying simple jump-and-place fallback`);
      // Simple jump-and-place fallback: jump and immediately call bot.placeBlock at apex.
      // Bot1 [2026-03-24] Session 55: _placeBlockWithOptions repeatedly failed with "placed 0/6"
      // even after elevation gain. Fallback bypasses forceLook/options and uses raw placeBlock.
      let fallbackPlaced = false;
      try {
        // Re-equip scaffold before fallback
        const fbScaffold = bot.inventory.items().find(i => isScaffoldBlock(i.name));
        if (fbScaffold) {
          await bot.equip(fbScaffold, "hand");
          console.error(`[Pillar] Fallback: equipped ${fbScaffold.name}`);

          // Look down before jumping
          const fbPos = bot.entity.position;
          await bot.lookAt(new Vec3(fbPos.x, fbPos.y - 1, fbPos.z), true);

          bot.setControlState("jump", true);
          await delay(400); // wait for jump apex
          bot.setControlState("jump", false);

          // Place block below feet while at/near apex
          const apexPos = bot.entity.position.offset(0, -1, 0);
          const refBlock = bot.blockAt(apexPos);
          console.error(`[Pillar] Fallback: blockAt offset(0,-1,0)=${refBlock?.name ?? 'null'} at (${apexPos.x.toFixed(1)},${apexPos.y.toFixed(1)},${apexPos.z.toFixed(1)})`);
          if (refBlock && refBlock.name !== "air" && refBlock.name !== "cave_air" && refBlock.name !== "void_air") {
            await Promise.race([
              bot.placeBlock(refBlock, new Vec3(0, 1, 0)),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("fallback placeBlock timeout 3s")), 3000)),
            ]);
            blocksPlaced++;
            placed = true;
            fallbackPlaced = true;
            consecutiveFailures = 0; // Reset failure counter on success
            console.error(`[Pillar] Fallback placed block ${blocksPlaced}/${targetHeight}`);
          } else {
            // Try scanning below current apex position
            const apexY = Math.floor(bot.entity.position.y);
            for (let scanY = apexY; scanY >= apexY - 3; scanY--) {
              const scanBlock = bot.blockAt(new Vec3(Math.floor(bot.entity.position.x), scanY, Math.floor(bot.entity.position.z)));
              console.error(`[Pillar] Fallback scan Y=${scanY}: ${scanBlock?.name ?? 'null'}`);
              if (scanBlock && scanBlock.name !== "air" && scanBlock.name !== "cave_air" && scanBlock.name !== "void_air") {
                await Promise.race([
                  bot.placeBlock(scanBlock, new Vec3(0, 1, 0)),
                  new Promise<void>((_, reject) => setTimeout(() => reject(new Error("fallback placeBlock scan timeout 3s")), 3000)),
                ]);
                blocksPlaced++;
                placed = true;
                fallbackPlaced = true;
                consecutiveFailures = 0; // Reset failure counter on success
                console.error(`[Pillar] Fallback placed block (scan) ${blocksPlaced}/${targetHeight}`);
                break;
              }
            }
          }
          await delay(200);
        }
      } catch (fbErr) {
        console.error(`[Pillar] Fallback jump-place failed: ${fbErr}`);
      }

      if (!fallbackPlaced) {
        consecutiveFailures++;
        console.error(`[Pillar] Fallback failed at level ${i + 1} (${consecutiveFailures}/3 consecutive failures)`);
        // After 3 consecutive placement failures (both primary and fallback), abort
        // Bot1 Session 54-55: pillarUp gained elevation but placed 0 blocks because loop
        // continued after placement failures. Now abort after 3 failures to prevent
        // untracked elevation gain that confuses the bot's survival state.
        if (consecutiveFailures >= 3) {
          console.error(`[Pillar] Aborting: 3 consecutive placement failures`);
          break;
        }
      }
    } else {
      // Reset failure counter on successful placement
      consecutiveFailures = 0;
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

  // POST-PILLAR HOSTILE CHECK: Warn if still surrounded by hostiles after elevated.
  // Bot1 [2026-03-25]: pillarUp(10) succeeded but creeperss/skeletons still nearby at ground
  // level. moveTo/flee then abort immediately (creeper_danger/ranged_mob_danger) because
  // checks fire based on entity distance, not vertical clearance. Bot was trapped on pillar.
  // Solution: After pillarUp with significant gain (≥4 blocks), if hostiles still nearby,
  // attempt pathfinder descent toward a safe horizontal position. From height, pathfinder
  // CAN navigate downward even through mob-dense areas because it routes around ground-level
  // mobs. Use a random horizontal offset (±10 blocks) to break out of the stuck column.
  if (gained >= 4) {
    const postPillarHostiles = Object.values(bot.entities)
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .map(e => ({ entity: e, dist: e.position.distanceTo(bot.entity.position) }))
      .filter(h => h.dist <= 20)
      .sort((a, b) => a.dist - b.dist);

    if (postPillarHostiles.length > 0) {
      console.error(`[Pillar] ${postPillarHostiles.length} hostile(s) still nearby after pillar (at Y=${finalY.toFixed(0)}). Attempting elevated flee...`);
      // Compute flee direction away from center-of-mass of all nearby hostiles
      let comX = 0, comZ = 0, totalWeight = 0;
      for (const h of postPillarHostiles) {
        const weight = 1 / Math.max(h.dist * h.dist, 1);
        comX += h.entity.position.x * weight;
        comZ += h.entity.position.z * weight;
        totalWeight += weight;
      }
      const centerX = totalWeight > 0 ? comX / totalWeight : bot.entity.position.x;
      const centerZ = totalWeight > 0 ? comZ / totalWeight : bot.entity.position.z;
      const awayX = bot.entity.position.x - centerX;
      const awayZ = bot.entity.position.z - centerZ;
      const len = Math.sqrt(awayX * awayX + awayZ * awayZ);
      const fleeTargetDist = 15;
      const targetX = len > 0.1
        ? bot.entity.position.x + (awayX / len) * fleeTargetDist
        : bot.entity.position.x + (Math.random() > 0.5 ? fleeTargetDist : -fleeTargetDist);
      const targetZ = len > 0.1
        ? bot.entity.position.z + (awayZ / len) * fleeTargetDist
        : bot.entity.position.z + (Math.random() > 0.5 ? fleeTargetDist : -fleeTargetDist);

      try {
        // From pillar height, pathfinder can descend. Use GoalNear at ground level.
        // Temporarily allow larger drops for descent from pillar.
        const prevDrop = bot.pathfinder.movements?.maxDropDown ?? 2;
        if (bot.pathfinder.movements) bot.pathfinder.movements.maxDropDown = gained + 2;
        const descentGoal = new goals.GoalNear(targetX, startY, targetZ, 3);
        bot.pathfinder.setGoal(descentGoal);
        const descentStartPos = bot.entity.position.clone();
        const descentStartTime = Date.now();
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
            resolve();
          }, 10000);
          const check = setInterval(() => {
            try {
              const descentDist = bot.entity.position.distanceTo(descentStartPos);
              const descentElapsed = Date.now() - descentStartTime;
              // Success: moved enough horizontally/vertically
              if (descentDist >= 3) {
                clearInterval(check);
                clearTimeout(timeout);
                try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
                resolve();
                return;
              }
              // Bot1 Session 67 [2026-03-25]: !isMoving() check at 300ms fired immediately
              // because pathfinder needs ~500-1500ms to compute a path from pillar top.
              // Exiting at 300ms with 0 movement meant the descent never ran at all.
              // Match the same guard used in flee() (elapsed > 2000) before trusting isMoving().
              if (descentElapsed > 2000 && !bot.pathfinder.isMoving()) {
                clearInterval(check);
                clearTimeout(timeout);
                try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
                resolve();
              }
            } catch {
              clearInterval(check); clearTimeout(timeout); resolve();
            }
          }, 300);
        });
        if (bot.pathfinder.movements) bot.pathfinder.movements.maxDropDown = prevDrop;
        const postDescentPos = bot.entity.position;
        const descentMoved = postDescentPos.distanceTo(descentStartPos);
        if (descentMoved >= 1) {
          console.error(`[Pillar] Post-pillar descent moved ${descentMoved.toFixed(1)} blocks to (${postDescentPos.x.toFixed(1)},${postDescentPos.y.toFixed(1)},${postDescentPos.z.toFixed(1)})`);
          result += `. Descended ${descentMoved.toFixed(0)} blocks from pillar to escape hostile area.`;
        } else {
          // Descent via direct pathfinder call failed (no path found or pathfinder refused).
          // Bot1 Session 67 [2026-03-25]: even with the isMoving() race-condition fix, the
          // pathfinder may find no valid path from pillar top when mob density is very high
          // or terrain is complex. Fall back to flee() which has robust multi-retry logic,
          // elevated-terrain maxDropDown handling, and direction rotation.
          console.error(`[Pillar] Post-pillar descent: pathfinder didn't move. Bot at Y=${postDescentPos.y.toFixed(0)}. Attempting flee() as fallback.`);
          try {
            const fleeResult = await flee(managed, 20);
            const afterFleePos = bot.entity.position;
            const fleeeMoved = afterFleePos.distanceTo(descentStartPos);
            if (fleeeMoved >= 3) {
              result += `. Escaped pillar via flee (moved ${fleeeMoved.toFixed(0)} blocks from pillar top).`;
            } else {
              result += `. [WARNING] Still near pillar at Y=${Math.floor(afterFleePos.y)} after flee. ${fleeResult}`;
            }
          } catch (fleeErr) {
            result += `. [WARNING] Still on pillar at Y=${Math.floor(postDescentPos.y)} with hostiles below. Both pathfinder descent and flee() failed. Try bot.moveTo() with a far-away coordinate.`;
          }
        }
      } catch (descentErr) {
        console.error(`[Pillar] Post-pillar descent failed: ${descentErr}`);
        result += `. [WARNING] Hostiles still nearby at Y=${Math.floor(bot.entity.position.y)}. Call bot.flee() to escape from pillar top.`;
      }
    }
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
    // PRE-FLEE AUTO-EAT: Eat food before fleeing if hunger <= 6.
    // In Minecraft, the player CANNOT sprint when hunger <= 6 (food bar icons).
    // mc_flee enables allowSprinting=true on the pathfinder, but this only tells
    // the pathfinder to plan sprint-speed paths — the game engine still blocks
    // sprinting at low hunger. Without food, flee achieves 50-60% of expected distance.
    // Bot1: 6+ deaths where mc_flee moved only 6-12 blocks instead of 20-30.
    // Bot2: 5+ deaths where mc_flee couldn't escape mob surround due to slow speed.
    // Eating before flee restores hunger above 6, enabling actual sprinting.
    const preFleeHunger = bot.food ?? 20;
    if (preFleeHunger <= 6) {
      const foodItem = bot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      if (foodItem) {
        try {
          await bot.equip(foodItem, "hand");
          await bot.consume();
          console.error(`[Flee] Pre-flee auto-ate ${foodItem.name} (hunger: ${preFleeHunger} → ${bot.food ?? "?"}) to enable sprinting`);
        } catch (_) { /* ignore eat errors — flee is still better slow than not at all */ }
      }
    }

    // PRE-FLEE ARMOR EQUIP: Equip any available armor before fleeing.
    // Bot1/Bot2/Bot3: many deaths during flee where mobs dealt full damage to unarmored bot.
    // Even iron boots reduce skeleton arrow damage from 5 to ~3. Quick equip takes <200ms.
    try {
      await equipArmor(bot);
    } catch (_) { /* continue without armor */ }

    // PRE-FLEE PILLAR UP when hostiles are in melee range (≤3 blocks).
    // Bug Session 50: bot.flee(40) was called after farm() timed out, but zombie was
    // already adjacent — bot died during the flee pathfinding startup (0.5-1s delay before
    // movement begins). Pillaring 3 blocks up takes ~1.5s but gets the bot out of melee
    // reach immediately, buying time for the pathfinder to plan a safe escape route.
    // Only pillar when hostiles are in immediate melee range (≤3 blocks) AND the bot has
    // blocks to place — we don't want to fail silently and waste time if no blocks available.
    {
      const meleeThreat = Object.values(bot.entities).find(e => {
        if (!isHostileMob(bot, e.name?.toLowerCase() || "")) return false;
        const dist = e.position.distanceTo(bot.entity.position);
        return dist <= 3;
      });
      if (meleeThreat) {
        const meleeDist = meleeThreat.position.distanceTo(bot.entity.position).toFixed(1);
        console.error(`[Flee] Melee threat detected (${meleeThreat.name} at ${meleeDist}m). Pillaring up 3 blocks before fleeing.`);
        try {
          // Pass ignoreThreats=true: this IS the emergency, no point aborting the pillar
          // just because the threat that triggered flee is within 4 blocks.
          await pillarUp(managed, 3, false, true);
          console.error(`[Flee] Pillar up complete — now at Y=${bot.entity.position.y.toFixed(0)}, continuing flee.`);
        } catch (pillarErr) {
          console.error(`[Flee] Pillar up failed (${pillarErr instanceof Error ? pillarErr.message : String(pillarErr)}), continuing flee anyway.`);
        }
      }
    }

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
    // Record initial distance to nearest hostile for post-flee validation.
    // Bot2 [2026-03-22]: mc_flee moved bot TOWARD enemies (distance 9.6→10.5→7.6m),
    // but there was no detection or warning. Track initial distance so we can warn
    // the caller if flee failed to increase distance (terrain routing issue).
    const initialHostileDist = hostile
      ? bot.entity.position.distanceTo(hostile.position)
      : Infinity;

    // Calculate flee direction
    let direction: { x: number; y: number; z: number; scaled: (n: number) => any };
    let fleeFromName: string;

    if (allHostiles.length > 0) {
      // Flee away from the weighted center of mass of ALL hostiles.
      // Bug [2026-03-25]: previous implementation accumulated "away" vectors (bot-hostile)
      // with inverse-square weights. This is mathematically equivalent to center-of-mass
      // but only when the direction from bot → center-of-mass happens to dominate. When
      // hostiles are arranged asymmetrically relative to the bot (e.g., 2 mobs at 5 blocks
      // behind, 1 mob at 8 blocks ahead) the weighted-away sum could point in a misleading
      // direction. Using explicit center-of-mass is simpler, more predictable, and easier
      // to debug. flee(250) from (-15,72,-4) with 3 threats → ended at (2,72,-4) with 6
      // threats (toward spawn), suggesting the previous direction calculation was wrong.
      //
      // New approach:
      //   1. Compute weighted center-of-mass of all hostile positions (closer = higher weight).
      //   2. direction = bot.position - centerOfMass (flee AWAY from the hostile cluster).
      let comX = 0, comZ = 0, totalWeight = 0;
      for (const h of allHostiles) {
        // Closer mobs have much more influence (inverse square of distance)
        const weight = 1 / Math.max(h.dist * h.dist, 1);
        comX += h.entity.position.x * weight;
        comZ += h.entity.position.z * weight;
        totalWeight += weight;
      }
      const centerX = totalWeight > 0 ? comX / totalWeight : bot.entity.position.x;
      const centerZ = totalWeight > 0 ? comZ / totalWeight : bot.entity.position.z;
      // Flee direction = bot position minus center of mass (horizontal only).
      // Zeroing Y ensures flee stays on the same elevation, preventing cave/hole routing.
      const awayX = bot.entity.position.x - centerX;
      const awayZ = bot.entity.position.z - centerZ;
      const horizontal = new (bot.entity.position as any).constructor(awayX, 0, awayZ);
      // If center of mass is directly under the bot (all hostiles vertically offset), pick random horizontal direction
      if (horizontal.norm() < 0.1) {
        const angle = Math.random() * 2 * Math.PI;
        direction = new (bot.entity.position as any).constructor(Math.cos(angle), 0, Math.sin(angle));
      } else {
        direction = horizontal.normalize();
      }
      fleeFromName = allHostiles.length === 1
        ? allHostiles[0].name
        : `${allHostiles.length} hostiles (${allHostiles.slice(0, 3).map(h => h.name).join(", ")})`;
      console.error(`[Flee] Fleeing from ${fleeFromName} — center-of-mass at (${centerX.toFixed(1)}, ${centerZ.toFixed(1)}), direction (${direction.x.toFixed(2)}, ${direction.z.toFixed(2)})`);
    } else {
      // No hostile found - flee in a random direction
      const angle = Math.random() * 2 * Math.PI;
      const vec = new (bot.entity.position as any).constructor(Math.cos(angle), 0, Math.sin(angle));
      direction = vec.normalize();
      fleeFromName = "danger";
      console.error(`[Flee] No hostile found, fleeing in random direction`);
    }

    // SAFETY: Validate flee direction doesn't lead to a cliff, hole, or lava.
    // Bot1 Session 21b, Bot2 [2026-03-22]: fled toward cliff edge, knockback/momentum
    // pushed bot off, causing fatal fall. Bot2: fled into cave hole (Y=80→Y=56).
    // Bot3 Death #8: fell into lava while fleeing.
    // Check at 3 AND 5 blocks in flee direction for ground safety.
    // Previous check only scanned 3 blocks — insufficient for birch_forest terrain where
    // cliffs and cave openings appear at 4-6 blocks from the bot's position.
    // If not safe, try 8 directions (45° increments) before giving up.
    // Previously only tried 4 directions (90° increments). On complex terrain like
    // old_growth_birch_forest with ravines/caves, all 4 cardinal rotations can be unsafe
    // while diagonal directions between them are safe.
    // Bot1/Bot2/Bot3 [2026-03-22]: "All flee directions have cliff drops" logged frequently,
    // causing flee to use the original unsafe direction. With 8 directions, the chance of
    // finding a safe path doubles.
    {
      const botPos = bot.entity.position;
      const bx = Math.floor(botPos.x);
      const by = Math.floor(botPos.y);
      const bz = Math.floor(botPos.z);
      // Elevated terrain (Y>75): cliff edges are normal terrain — the bot is on a hilltop
      // or birch forest cliff where ALL surrounding squares are cliff edges dropping 5-20 blocks.
      // Bot1 Sessions 56-59: bot at Y=91 in birch_forest — every direction has a cliff drop
      // greater than dy=3, so all 8 directions fail the safety check → distance collapses to 5
      // → pathfinder finds no path at 5 blocks → flee completely fails → bot frozen.
      // Fix: at elevated starts (Y>75), allow ground to be up to 8 blocks below check position.
      // This lets the safety check accept "ground 6 blocks below" as reachable terrain, which
      // the pathfinder can navigate to via stair-stepping or small drops.
      // Normal surface (Y<=75): keep dy=3 to prevent fleeing toward cave holes.
      const elevatedFlee = by > 75;
      const maxDyCheck = elevatedFlee ? 8 : 3;
      let bestDirection = direction;
      let foundSafe = false;
      // Try 8 directions: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315° from original
      for (let rotation = 0; rotation < 8; rotation++) {
        const angle = Math.atan2(direction.z, direction.x) + (Math.PI / 4) * rotation;
        // Check FOUR points along the flee path: 1, 2, 3, and 5 blocks ahead.
        // Previous check only scanned [3, 5], missing holes/cliffs at 1-2 blocks.
        // Bot1/Bot2 [2026-03-22]: bot fell into holes directly in front (1-2 blocks)
        // that the safety scan missed because it started checking at 3 blocks out.
        let directionSafe = true;
        for (const checkDist of [1, 2, 3, 5]) {
          const checkX = bx + Math.round(Math.cos(angle) * checkDist);
          const checkZ = bz + Math.round(Math.sin(angle) * checkDist);
          // Check for ground within maxDyCheck blocks below — also reject lava.
          // Also check ABOVE bot Y for water (mountain pools): Session 80 bot drowned at Y=115
          // because flee target was in a high-altitude water pool. The downward scan (by-dy)
          // missed it because the pool was above the bot's Y at time of direction check.
          let hasSafeGround = false;
          // First: reject if any block at or above bot Y (up to 4) is water/lava at this XZ.
          for (let upDy = 0; upDy <= 4; upDy++) {
            const upBlock = bot.blockAt(new Vec3(checkX, by + upDy, checkZ));
            if (!upBlock) continue;
            if (isWaterBlock(upBlock.name) || isLavaBlock(upBlock.name)) {
              hasSafeGround = false;
              directionSafe = false;
              break;
            }
          }
          if (!directionSafe) break;
          for (let dy = 0; dy <= maxDyCheck; dy++) {
            const block = bot.blockAt(new Vec3(checkX, by - dy, checkZ));
            if (!block) continue;
            // Lava is NOT safe ground — Bot3 #8: fell into lava while fleeing.
            // Check both source and flowing lava.
            if (isLavaBlock(block.name)) {
              hasSafeGround = false;
              break;
            }
            // SAFETY: Treat water as unsafe ground during flee.
            // Bot1 Session 39, Bot2 [2026-03-23]: flee routed into water, bot drowned.
            // liquidCost=10000 penalizes water paths but doesn't prevent them when no
            // land route exists. Treating water as unsafe in the direction check ensures
            // flee never TARGETS a water area. The pathfinder may still touch water edges,
            // but the flee direction won't aim at rivers/lakes/ocean.
            if (isWaterBlock(block.name)) {
              hasSafeGround = false;
              break;
            }
            if (block.name !== "air" && block.name !== "cave_air" && block.name !== "void_air") {
              hasSafeGround = true;
              break;
            }
          }
          if (!hasSafeGround) {
            directionSafe = false;
            break;
          }
        }
        if (directionSafe) {
          if (rotation > 0) {
            bestDirection = new (botPos as any).constructor(Math.cos(angle), 0, Math.sin(angle));
            console.error(`[Flee] Original direction leads to cliff/hole/lava/water — rotated ${rotation * 45}° to safe direction.`);
          }
          foundSafe = true;
          break;
        }
      }
      if (!foundSafe) {
        // All 8 directions are unsafe (cliff/hole/lava/water).
        // Normal terrain: reduce flee distance to 5 blocks to minimize exposure.
        // Bot1/Bot2/Bot3 [2026-03-22]: full-distance flee into unsafe terrain caused falls
        // (Y=80→56, Y=116→86) because maxDropDown=1 doesn't prevent the bot from CHOOSING
        // a path toward a cliff — it only limits per-step drops.
        //
        // Elevated terrain exception (Bot1 Sessions 56-59):
        // At Y>75 all 8 directions may be cliff edges (expected for hilltop/birch_forest),
        // but that does NOT mean the terrain is impassable — it means the bot needs to descend.
        // At elevated positions, do NOT collapse distance to 5; keep original distance so
        // pathfinder can plan a real escape route down the cliff.
        // Also try fleeing perpendicular to the nearest hostile (likely less obstructed).
        if (allHostiles.length > 0) {
          const nearestAway = bot.entity.position.minus(allHostiles[0].entity.position);
          const perpAngle = Math.atan2(nearestAway.z, nearestAway.x) + Math.PI / 2;
          bestDirection = new (bot.entity.position as any).constructor(Math.cos(perpAngle), 0, Math.sin(perpAngle));
          if (elevatedFlee) {
            console.error(`[Flee] WARNING: All 8 flee directions have cliffs/drops (elevated terrain Y=${by}). Using perpendicular direction — pathfinder will find descent route.`);
          } else {
            console.error(`[Flee] WARNING: All 8 flee directions unsafe. Using perpendicular direction with reduced distance (${Math.min(distance, 5)} blocks).`);
            distance = Math.min(distance, 5);
          }
        } else {
          if (elevatedFlee) {
            console.error(`[Flee] WARNING: All 8 flee directions have cliffs/drops (elevated terrain Y=${by}). Using original direction — pathfinder will find descent route.`);
          } else {
            console.error(`[Flee] WARNING: All 8 flee directions unsafe. Using original direction with reduced distance (${Math.min(distance, 5)} blocks).`);
            distance = Math.min(distance, 5);
          }
        }
      }
      direction = bestDirection;
    }

    // Flee target at same Y level as bot — never target underground positions
    const fleeTarget = bot.entity.position.plus(direction.scaled(distance));
    const startPos = bot.entity.position.clone();

    // SAFETY: Limit drop-downs and penalize liquid during flee.
    // maxDropDown=2 allows 1-2 block drops (no fall damage) while preventing cliff falls.
    // Previous maxDropDown=0 was TOO restrictive: on hilly terrain (old_growth_birch_forest),
    // the pathfinder couldn't navigate at all because nearly every path involves a 1-block drop.
    // Bot3 #26: fled only 7.2 blocks because maxDropDown=0 blocked all downhill movement.
    // liquidCost=10000 prevents water routing (drowning).
    //
    // Elevated terrain exception (Bot1 Sessions 56-59):
    // At Y>75, the bot is on a cliff/hill — descending IS the escape route.
    // maxDropDown=2 blocks the pathfinder from descending cliffs (5-15 block drops),
    // making flee completely ineffective on elevated terrain.
    // Allow maxDropDown=5 at Y>75 so pathfinder can navigate cliff descents during flee.
    // The safeSetGoal Y-descent monitor (fleeMaxYDescent=15) provides an independent
    // cap on total descent, preventing runaway cave routing even with maxDropDown=5.
    const fleeStartElevated = bot.entity.position.y > 75;
    const prevMaxDropDown = bot.pathfinder.movements?.maxDropDown ?? 2;
    const prevLiquidCost = (bot.pathfinder.movements as any)?.liquidCost ?? 100;
    const prevAllowSprinting = bot.pathfinder.movements?.allowSprinting ?? true;
    const prevCanDig = bot.pathfinder.movements?.canDig ?? true;
    if (bot.pathfinder.movements) {
      bot.pathfinder.movements.maxDropDown = fleeStartElevated ? 5 : 2;
      (bot.pathfinder.movements as any).liquidCost = 100000;
      // Disable water walking entirely — liquidCost alone is sometimes insufficient.
      // Bot2 [2026-03-23]: flee routed into water despite liquidCost=10000 because
      // pathfinder calculated water path as only viable option. With placeLiquid=false
      // and very high liquidCost, pathfinder should refuse water paths more aggressively.
      bot.pathfinder.movements.allowParkour = false;
      // Enable sprinting during flee — this is an emergency escape, speed is critical.
      // Bot3 #26: fled only 7.2 blocks in 8s without sprint. Sprinting doubles speed.
      bot.pathfinder.movements.allowSprinting = true;
      // SAFETY: Disable canDig during flee — surface flee should NEVER dig into terrain.
      // Bot2 [2026-03-22]: mc_flee with canDig=true dug through surface, bot fell from
      // Y=80 to Y=56 into a cave system and was trapped underground with 9 mobs.
      // Flee uses setGoal() directly (bypasses moveToBasic safety checks), so canDig
      // cave prevention from moveToBasic doesn't apply. Must disable explicitly here.
      //
      // UNDERGROUND EXCEPTION: Session 66 [2026-03-25]: at Y=56 in a cave with
      // canDig=false, the pathfinder cannot route at ALL — every direction is blocked by
      // stone cave walls. Bot cannot flee even 1 block. When already underground (Y<65),
      // the bot is already in a cave, so canDig=true is required to dig through walls.
      // The safeSetGoal Y-descent monitor (fleeMaxYDescent=4) prevents runaway descent.
      const fleeIsUnderground = bot.entity.position.y < 65;
      bot.pathfinder.movements.canDig = fleeIsUnderground ? true : false;
      // SAFETY: Add water and lava to blocksToAvoid for flee pathfinding.
      // liquidCost=100000 penalizes fluids but pathfinder may still route through them
      // when no pure-land route exists (underground caves, enclosed spaces).
      // Bot1 Session 65 [2026-03-25]: flee() at Y=37 underground routed through lava —
      // "Claude1 tried to swim in lava". blocksToAvoid makes fluids truly impassable.
      const fleeWater = bot.registry.blocksByName["water"];
      const fleeFlowingWater = bot.registry.blocksByName["flowing_water"];
      const fleeLava = bot.registry.blocksByName["lava"];
      const fleeFlowingLava = bot.registry.blocksByName["flowing_lava"];
      if (fleeWater) bot.pathfinder.movements.blocksToAvoid.add(fleeWater.id);
      if (fleeFlowingWater) bot.pathfinder.movements.blocksToAvoid.add(fleeFlowingWater.id);
      if (fleeLava) bot.pathfinder.movements.blocksToAvoid.add(fleeLava.id);
      if (fleeFlowingLava) bot.pathfinder.movements.blocksToAvoid.add(fleeFlowingLava.id);
    }

    // Use a mutable reference so flee retries can replace the handle.
    // The in-loop retries previously used raw bot.pathfinder.setGoal() without
    // safeSetGoal, bypassing Y-descent monitoring. This allowed retries to route
    // into caves without any abort.
    // Bot2 [2026-03-22]: flee retry sent bot from Y=80 into cave at Y=56 because
    // the retry direction bypassed safeSetGoal's Y-descent check.
    //
    // ELEVATED TERRAIN EXCEPTION (Bot1 Session 56):
    // Bot at Y=92, safeSetGoal maxYDescent=4 fired immediately as any flee path descends
    // 5+ blocks naturally on elevated birch forest terrain → flee always aborted → bot froze.
    // Fix: when start Y>75, allow 30-block descent (birch forest cliffs can be Y=89→Y=63 = 26 blocks).
    // 15 was insufficient: Y=89 cliff → Y=70 ground = 19 blocks > 15 limit → flee always aborted.
    // Normal surface (Y<=75): keep 4-block limit (prevents cave routing).
    const fleeMaxYDescent = startPos.y > 75 ? 30 : 4;
    let currentFleeHandle = safeSetGoal(bot,
      new goals.GoalNear(fleeTarget.x, fleeTarget.y, fleeTarget.z, 3),
      {
        maxYDescent: fleeMaxYDescent,
        onAbort: (yDescent) => {
          console.error(`[Flee] CAVE DESCENT ABORT: Bot dropped ${yDescent.toFixed(1)} blocks during flee (Y=${startPos.y.toFixed(0)}→${bot.entity.position.y.toFixed(0)}, limit=${fleeMaxYDescent}). Stopping.`);
          try { bot.setControlState("sprint", false); bot.setControlState("sneak", false); } catch { /* ignore */ }
        }
      }
    );

    // Explicitly enable sprint control state — pathfinder's allowSprinting only affects
    // path planning, but doesn't guarantee the bot actually sprints. Setting the control
    // state ensures the bot sprints as soon as the pathfinder starts moving.
    // Only effective when hunger > 6 (Minecraft physics requirement).
    if ((bot.food ?? 20) > 6) {
      bot.setControlState("sprint", true);
    }

    // Scale timeout with requested distance. Base 10s + 0.5s per block beyond 20.
    // Bot3 #26: 8s timeout was too short for 30-50 block flee on rough terrain.
    // Cap raised to 45s: with maxDropDown=1 on hilly terrain (birch_forest, mountains),
    // pathfinder needs extra time for direction retries and constrained routing.
    // Bot2 [2026-03-23]: flee(60) only moved 12-20m from Pillager — 30s cap was too short
    // for the pathfinder to navigate complex terrain with multiple retries.
    const fleeTimeoutMs = Math.min(Math.max(10000, 10000 + (distance - 20) * 500), 45000);

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

          if (currentFleeHandle.aborted) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve();
            return;
          }

          // SAFETY: Abort flee if bot enters water OR is about to enter water.
          // Bot1 Session 39, Bot2 [2026-03-23]: flee routed into water despite liquidCost=10000.
          // When pathfinder can't find a pure-land route, it routes through water as a fallback.
          // Detect this and abort immediately — staying on land near a hostile is safer than drowning.
          // Also check 2 blocks ahead in movement direction for PREDICTIVE water avoidance.
          // Bot2 [2026-03-23]: 200ms check interval meant bot was already submerged before abort.
          {
            const fleePos = bot.entity.position;
            const fleeFeetBlock = bot.blockAt(new Vec3(Math.floor(fleePos.x), Math.floor(fleePos.y), Math.floor(fleePos.z)));
            const fleeHeadBlock = bot.blockAt(new Vec3(Math.floor(fleePos.x), Math.floor(fleePos.y) + 1, Math.floor(fleePos.z)));

            // Predictive check: look 2 blocks ahead in the direction bot is moving
            const vel = bot.entity.velocity;
            let waterAhead = false;
            if (vel && (Math.abs(vel.x) > 0.05 || Math.abs(vel.z) > 0.05)) {
              const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
              if (speed > 0.05) {
                const dx = vel.x / speed;
                const dz = vel.z / speed;
                for (const dist of [1, 2]) {
                  const aheadX = Math.floor(fleePos.x + dx * dist);
                  const aheadZ = Math.floor(fleePos.z + dz * dist);
                  const aheadY = Math.floor(fleePos.y);
                  const aheadBlock = bot.blockAt(new Vec3(aheadX, aheadY, aheadZ));
                  const aheadBlockBelow = bot.blockAt(new Vec3(aheadX, aheadY - 1, aheadZ));
                  if ((aheadBlock && isWaterBlock(aheadBlock.name)) ||
                      (aheadBlockBelow && isWaterBlock(aheadBlockBelow.name))) {
                    waterAhead = true;
                    break;
                  }
                }
              }
            }

            if ((fleeFeetBlock && isWaterBlock(fleeFeetBlock.name)) || (fleeHeadBlock && isWaterBlock(fleeHeadBlock.name))) {
              console.error(`[Flee] WATER ABORT: Bot entered water at (${fleePos.x.toFixed(1)}, ${fleePos.y.toFixed(1)}, ${fleePos.z.toFixed(1)}). Stopping flee to prevent drowning.`);
              clearInterval(check);
              clearTimeout(timeout);
              try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
              // Try to swim up by holding jump
              try { bot.setControlState("jump", true); } catch { /* ignore */ }
              setTimeout(() => { try { bot.setControlState("jump", false); } catch { /* ignore */ } }, 3000);
              resolve();
              return;
            }
            if (waterAhead) {
              console.error(`[Flee] WATER AHEAD ABORT: Water detected 1-2 blocks ahead of movement direction at (${fleePos.x.toFixed(1)}, ${fleePos.y.toFixed(1)}, ${fleePos.z.toFixed(1)}). Stopping flee to prevent entering water.`);
              clearInterval(check);
              clearTimeout(timeout);
              try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
              try { bot.setControlState("sprint", false); } catch { /* ignore */ }
              resolve();
              return;
            }
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
              // Clean up the previous safeSetGoal monitor before starting a new one.
              // Previously used raw bot.pathfinder.setGoal() which bypassed Y-descent monitoring,
              // allowing retries to route into caves.
              currentFleeHandle.cleanup();
              currentFleeHandle = safeSetGoal(bot, retryGoal, {
                maxYDescent: fleeMaxYDescent,
                onAbort: (yDescent) => {
                  console.error(`[Flee] CAVE DESCENT ABORT during retry #${retryCount}: dropped ${yDescent.toFixed(1)} blocks (Y=${startPos.y.toFixed(0)}→${bot.entity.position.y.toFixed(0)}, limit=${fleeMaxYDescent}). Stopping.`);
                  try { bot.setControlState("sprint", false); bot.setControlState("sneak", false); } catch { /* ignore */ }
                }
              });
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

    // POST-FLEE POSITION CHECK: If the bot barely moved (< 5 blocks), the flee failed.
    // Bot1 Session 52: flee(40) x3 all returned to same coordinates (x=2,y=70,z=5).
    // Root cause: near water (drowned spawns), all 8 direction checks fail isWaterBlock,
    // so distance collapses to 5 blocks and the bot barely moves. Drowned follows to the
    // same spot each time, so repeated flee() calls produce the same position.
    // Fix: try up to 2 additional angles (120° and 240° from the original direction) when
    // the bot didn't move at least 5 blocks. Each retry uses a fresh direction and full distance.
    {
      const postMainPos = bot.entity.position;
      const mainMoved = postMainPos.distanceTo(startPos);
      if (mainMoved < 5) {
        console.error(`[Flee] Position barely changed after flee (moved ${mainMoved.toFixed(1)} blocks). Attempting directional retries to escape.`);
        const baseAngle = Math.atan2(direction.z, direction.x);
        // Try 120° and 240° rotations — gives maximum angular spread (equilateral triangle)
        for (let retryIdx = 1; retryIdx <= 2; retryIdx++) {
          const curPos = bot.entity.position;
          const totalMoved = curPos.distanceTo(startPos);
          if (totalMoved >= 5) break; // Succeeded in a previous retry
          const retryAngle = baseAngle + (retryIdx * 2 * Math.PI) / 3; // 120° * retryIdx
          const retryDist = Math.max(distance, 20); // Use at least 20 blocks regardless of water reduction
          const retryDir = new Vec3(Math.cos(retryAngle), 0, Math.sin(retryAngle));
          const retryTarget = curPos.plus(retryDir.scaled(retryDist));
          console.error(`[Flee] Directional retry #${retryIdx}: angle ${(retryIdx * 120)}° from original, target (${retryTarget.x.toFixed(0)}, ${retryTarget.y.toFixed(0)}, ${retryTarget.z.toFixed(0)})`);
          if (bot.pathfinder.movements) {
            bot.pathfinder.movements.maxDropDown = 2;
            // Underground (Y<65): enable canDig for directional retries.
            // Session 66 [2026-03-25]: at Y=56 in a cave, canDig=false means pathfinder
            // cannot route through stone cave walls — all retry directions fail immediately.
            // At surface (Y>=65), canDig=false prevents cave routing. Underground, the bot
            // IS already in a cave, so digging through walls is the only escape option.
            bot.pathfinder.movements.canDig = bot.entity.position.y < 65 ? true : false;
            (bot.pathfinder.movements as any).liquidCost = 100000;
            bot.pathfinder.movements.allowSprinting = true;
          }
          if ((bot.food ?? 20) > 6) {
            bot.setControlState("sprint", true);
          }
          const retryHandle = safeSetGoal(bot,
            new goals.GoalNear(retryTarget.x, retryTarget.y, retryTarget.z, 3),
            {
              maxYDescent: fleeMaxYDescent,
              onAbort: (yDescent) => {
                console.error(`[Flee] Directional retry #${retryIdx} CAVE DESCENT: dropped ${yDescent.toFixed(1)} blocks (limit=${fleeMaxYDescent}). Aborting.`);
                try { bot.setControlState("sprint", false); } catch { /* ignore */ }
              }
            }
          );
          const retryTimeoutMs = Math.min(Math.max(8000, 8000 + (retryDist - 20) * 300), 20000);
          const retryStartPos = bot.entity.position.clone();
          await new Promise<void>((resolve) => {
            const retryTimeout = setTimeout(() => {
              retryHandle.cleanup();
              try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
              resolve();
            }, retryTimeoutMs);
            const retryCheckStart = Date.now();
            const retryCheck = setInterval(() => {
              try {
                if (retryHandle.aborted) {
                  clearInterval(retryCheck); clearTimeout(retryTimeout);
                  resolve(); return;
                }
                const retryMoved = bot.entity.position.distanceTo(retryStartPos);
                if (retryMoved >= retryDist * 0.5) {
                  clearInterval(retryCheck); clearTimeout(retryTimeout);
                  retryHandle.cleanup();
                  try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
                  resolve(); return;
                }
                const retryElapsed = Date.now() - retryCheckStart;
                if (retryElapsed > 2000 && !bot.pathfinder.isMoving()) {
                  clearInterval(retryCheck); clearTimeout(retryTimeout);
                  retryHandle.cleanup();
                  try { bot.pathfinder.setGoal(null); } catch { /* ignore */ }
                  resolve(); return;
                }
              } catch {
                clearInterval(retryCheck); clearTimeout(retryTimeout);
                resolve();
              }
            }, 200);
          });
          bot.setControlState("sprint", false);
          const retryMovedFinal = bot.entity.position.distanceTo(retryStartPos);
          console.error(`[Flee] Directional retry #${retryIdx} result: moved ${retryMovedFinal.toFixed(1)} blocks`);
          retryHandle.cleanup();
        }

        // UNDERGROUND LAST RESORT: Session 66 [2026-03-25]
        // If bot is underground (Y<65) and all horizontal flee attempts failed (moved <5 blocks),
        // the bot is completely enclosed by cave walls. The only escape is VERTICAL: dig up.
        // emergencyDigUp() digs straight up block by block, ascending the cave ceiling.
        // This is a last resort — it's slow (~3s/block) but the only remaining option
        // when pathfinder cannot find ANY horizontal route even with canDig=true.
        const finalPos = bot.entity.position;
        const finalMoved = finalPos.distanceTo(startPos);
        if (finalMoved < 5 && finalPos.y < 65) {
          console.error(`[Flee] Underground (Y=${finalPos.y.toFixed(0)}) and horizontal flee completely failed (moved ${finalMoved.toFixed(1)} blocks). Using emergencyDigUp() as last resort.`);
          try {
            bot.pathfinder.setGoal(null);
            bot.clearControlStates();
            const digUpResult = await emergencyDigUp(managed, 30);
            console.error(`[Flee] emergencyDigUp result: ${digUpResult}`);
          } catch (digErr) {
            console.error(`[Flee] emergencyDigUp failed: ${digErr instanceof Error ? digErr.message : String(digErr)}`);
          }
        }

        // SURFACE CAGE LAST RESORT: Sessions 66-68 [2026-03-25]
        // If bot is at surface level (Y>=65) and ALL horizontal flee attempts failed (moved <5 blocks),
        // the bot may be caged by its own placed blocks (pillar + staircase walling it in).
        // Detect cage: check if ≥3 of 4 horizontal sides are solid at BOTH feet and head level.
        // If caged, try canDig=true pathfinding to break through the nearest wall.
        // This is intentionally separate from underground (canDig already=true underground):
        // surface flee uses canDig=false by default to prevent cave routing.
        // A surface cage only happens when the bot itself placed blocks forming an enclosure.
        if (finalMoved < 5 && finalPos.y >= 65) {
          const cageCheckX = Math.floor(finalPos.x);
          const cageCheckY = Math.floor(finalPos.y);
          const cageCheckZ = Math.floor(finalPos.z);
          const cageDirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
          const isAirLike = (name: string | undefined) =>
            !name || name === "air" || name === "cave_air" || name === "void_air";
          let cageSolidCount = 0;
          for (const [cdx, cdz] of cageDirs) {
            const feetB = bot.blockAt(new Vec3(cageCheckX + cdx, cageCheckY, cageCheckZ + cdz));
            const headB = bot.blockAt(new Vec3(cageCheckX + cdx, cageCheckY + 1, cageCheckZ + cdz));
            if (!isAirLike(feetB?.name) || !isAirLike(headB?.name)) {
              cageSolidCount++;
            }
          }
          console.error(`[Flee] Surface position (Y=${cageCheckY}), solid sides: ${cageSolidCount}/4. Flee moved only ${finalMoved.toFixed(1)} blocks.`);
          if (cageSolidCount >= 3) {
            console.error(`[Flee] SURFACE CAGE DETECTED (${cageSolidCount}/4 sides blocked). Attempting canDig=true escape...`);
            // Find the direction with the lowest-hardness block and try to dig through it.
            // Also try canDig pathfinder as backup.
            let softestDir: [number, number] = [1, 0];
            let lowestHardness = Infinity;
            for (const [cdx, cdz] of cageDirs) {
              const b = bot.blockAt(new Vec3(cageCheckX + cdx, cageCheckY, cageCheckZ + cdz));
              if (b && b.hardness >= 0 && b.hardness < lowestHardness) {
                lowestHardness = b.hardness;
                softestDir = [cdx, cdz];
              }
            }
            try {
              // Manual dig through feet + head level of softest wall.
              const pickaxePriority = ["netherite_pickaxe","diamond_pickaxe","iron_pickaxe","stone_pickaxe","wooden_pickaxe"];
              for (const toolName of pickaxePriority) {
                const tool = bot.inventory.items().find((i: any) => i.name === toolName);
                if (tool) { try { await bot.equip(tool, "hand"); } catch { /* ignore */ } break; }
              }
              for (const dy of [0, 1]) {
                const digTarget = new Vec3(cageCheckX + softestDir[0], cageCheckY + dy, cageCheckZ + softestDir[1]);
                const digBlock = bot.blockAt(digTarget);
                if (digBlock && digBlock.hardness >= 0 && !isAirLike(digBlock.name)) {
                  try {
                    await bot.lookAt(digTarget.offset(0.5, 0.5, 0.5), true);
                    await Promise.race([
                      bot.dig(digBlock),
                      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("dig timeout")), 6000)),
                    ]);
                    console.error(`[Flee] Cage escape: dug ${digBlock.name} at (${digTarget.x},${digTarget.y},${digTarget.z})`);
                  } catch (de) {
                    console.error(`[Flee] Cage escape: dig failed: ${de}`);
                  }
                }
              }
              // Now walk through the dug hole with sprint+jump.
              const cageEscapeAngle = Math.atan2(softestDir[0], softestDir[1]);
              await bot.look(cageEscapeAngle, 0, true);
              bot.setControlState("sprint", true);
              bot.setControlState("forward", true);
              bot.setControlState("jump", true);
              await delay(1500);
              bot.clearControlStates();
              const cageEscapePos = bot.entity.position;
              const cageEscapeMoved = cageEscapePos.distanceTo(finalPos);
              console.error(`[Flee] Cage escape result: moved ${cageEscapeMoved.toFixed(1)} blocks. New pos: (${cageEscapePos.x.toFixed(1)},${cageEscapePos.y.toFixed(1)},${cageEscapePos.z.toFixed(1)})`);
            } catch (cageErr) {
              console.error(`[Flee] Cage escape error: ${cageErr instanceof Error ? cageErr.message : String(cageErr)}`);
            }
          } else if (finalMoved < 5) {
            // Not fully caged but still frozen. Try raw movement (bypass pathfinder).
            // This can happen when pathfinder state is corrupted (entity desync).
            // Session 68: pathfinder returned instantly with 0 displacement even though
            // the bot entity is valid. Raw setControlState bypasses pathfinder entirely.
            console.error(`[Flee] Surface freeze detected (moved ${finalMoved.toFixed(1)} blocks, ${cageSolidCount}/4 sides blocked). Attempting raw control-state movement as pathfinder bypass.`);
            try {
              // Try each open direction for 2 seconds.
              for (const [cdx, cdz] of cageDirs) {
                const feetB = bot.blockAt(new Vec3(cageCheckX + cdx, cageCheckY, cageCheckZ + cdz));
                const headB = bot.blockAt(new Vec3(cageCheckX + cdx, cageCheckY + 1, cageCheckZ + cdz));
                if (isAirLike(feetB?.name) && isAirLike(headB?.name)) {
                  const rawAngle = Math.atan2(cdx, cdz);
                  await bot.look(rawAngle, 0, true);
                  bot.setControlState("sprint", true);
                  bot.setControlState("forward", true);
                  bot.setControlState("jump", true);
                  await delay(2000);
                  bot.clearControlStates();
                  const rawMoved = bot.entity.position.distanceTo(finalPos);
                  console.error(`[Flee] Raw movement in direction (${cdx},${cdz}): moved ${rawMoved.toFixed(1)} blocks`);
                  if (rawMoved >= 1) break;
                }
              }
            } catch (rawErr) {
              console.error(`[Flee] Raw movement escape failed: ${rawErr}`);
            }
          }
        }
      }
    }

    // Clear sprint control state after flee completes.
    // bot.setControlState("sprint", true) was set at line ~1695 but never cleared on
    // normal exit. Sprint persists into subsequent actions (eating, crafting, gathering),
    // draining hunger faster and preventing reliable food consumption.
    // Bot1/Bot2 [2026-03-22]: hunger dropped rapidly after flee, causing starvation spiral.
    bot.setControlState("sprint", false);

    // Restore previous pathfinder settings after flee completes.
    // NOTE: Do NOT restore canDig here — same race condition as AutoFlee/CreeperFlee.
    // If mc_navigate starts immediately after flee, moveToBasic sets canDig=false
    // (night/low-HP safety), but restoring prevCanDig=true here would override that,
    // allowing pathfinder to dig into caves. Let the next moveTo call decide canDig
    // based on current time-of-day and HP (see moveToBasic L541-557).
    // Bot1/Bot2/Bot3 [2026-03-22]: multiple deaths from cave routing after mc_flee
    // because canDig was restored to true, defeating the night cave-routing protection.
    currentFleeHandle.cleanup();
    if (bot.pathfinder.movements) {
      bot.pathfinder.movements.allowSprinting = prevAllowSprinting;
      // Restore allowParkour — was disabled during flee to prevent jumping into water.
      // Safe to restore since non-flee navigation handles parkour independently.
      bot.pathfinder.movements.allowParkour = true;
      // Restore maxDropDown to safe default (2), NOT the previous value.
      // prevMaxDropDown could be higher if set by other code or mineflayer defaults,
      // which would undo the safe limit. moveToBasic always sets maxDropDown=2,
      // so restoring to 2 matches the expected safe state for subsequent navigation.
      bot.pathfinder.movements.maxDropDown = 2;
      // Keep liquidCost high to prevent water routing (drowning risk).
      // Don't restore prevLiquidCost — it may have been the low default value.
      // moveToBasic always sets liquidCost=10000, so maintain that safe state.
      (bot.pathfinder.movements as any).liquidCost = 10000;
      // canDig is intentionally NOT restored — next moveTo handles it
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

    // Post-flee water warning: detect if bot ended up in water despite the water abort.
    // Bot1 Session 39, Bot2 [2026-03-23]: flee deposited bot in water → pillarUp failed → drowned.
    // This can happen if the water abort didn't trigger (e.g., bot entered water on the very last tick).
    {
      const endFeetBlock = bot.blockAt(new Vec3(Math.floor(endPos.x), Math.floor(endPos.y), Math.floor(endPos.z)));
      if (endFeetBlock && isWaterBlock(endFeetBlock.name)) {
        console.error(`[Flee] WARNING: Bot is in water after flee at (${endPos.x.toFixed(1)}, ${endPos.y.toFixed(1)}, ${endPos.z.toFixed(1)}). Swimming up.`);
        caveWarning += ` [WARNING] Ended up in water after flee. Swim to land before pillarUp or other actions.`;
        // Try to swim up
        try { bot.setControlState("jump", true); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 2000));
        try { bot.setControlState("jump", false); } catch { /* ignore */ }
      }
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
      // Post-flee hostile distance validation: detect when flee moved TOWARD enemies.
      // Bot2 [2026-03-22]: mc_flee(30) x3 caused distance to DECREASE (9.6→10.5→7.6m).
      // This happens when terrain forces the pathfinder to route around obstacles toward
      // the hostile, or when the flee direction calculation pointed toward a blocked area.
      // Warn the caller so they can try a different escape strategy (dig shelter, pillar up).
      let fleeFailWarning = "";
      if (newDist < initialHostileDist && initialHostileDist < Infinity) {
        // Automatic perpendicular retry: when flee moved TOWARD the hostile, try fleeing
        // perpendicular to the hostile direction. This happens when terrain (cliffs, water,
        // walls) blocks the direct-away direction and pathfinder routes around the obstacle
        // toward the hostile. A perpendicular direction often has clear terrain.
        // Bot2 [2026-03-22]: flee(30) x3 caused distance to decrease 9.6→10.5→7.6m,
        // leading to death. A single perpendicular retry would have escaped sideways.
        console.error(`[Flee] WARNING: Flee moved CLOSER (${initialHostileDist.toFixed(1)} → ${newDist.toFixed(1)}). Attempting perpendicular retry...`);
        try {
          const retryAway = bot.entity.position.minus(hostile.position);
          let perpAngle = Math.atan2(retryAway.z, retryAway.x) + Math.PI / 2;

          // SAFETY: Ground check for perpendicular retry direction.
          // Previous code skipped safety checks for the retry — main flee scans 8 directions
          // for cliffs/holes/lava but the perpendicular retry set a goal blindly.
          // Bot2 [2026-03-22]: perpendicular retry sent bot into cave hole (Y=80→56).
          // Check both perpendicular directions (+90° and -90°) for ground safety.
          {
            const retryBotPos = bot.entity.position;
            const retryBx = Math.floor(retryBotPos.x);
            const retryBy = Math.floor(retryBotPos.y);
            const retryBz = Math.floor(retryBotPos.z);
            // Same elevated terrain exception as main flee direction check:
            // at Y>75 all squares may be cliff edges, use deeper dy scan.
            const retryElevated = retryBy > 75;
            const retryMaxDy = retryElevated ? 8 : 3;
            let retryDirSafe = false;
            for (const angleOffset of [0, Math.PI]) { // Try +90° first, then -90°
              const testAngle = perpAngle + angleOffset;
              let safe = true;
              for (const checkDist of [1, 2, 3, 5]) {
                const checkX = retryBx + Math.round(Math.cos(testAngle) * checkDist);
                const checkZ = retryBz + Math.round(Math.sin(testAngle) * checkDist);
                let hasSafeGround = false;
                for (let dy = 0; dy <= retryMaxDy; dy++) {
                  const block = bot.blockAt(new Vec3(checkX, retryBy - dy, checkZ));
                  if (!block) continue;
                  // Check both source and flowing lava — flowing_lava was missed by
                  // commit 500965e which fixed this in the main flee direction check
                  // but not the perpendicular retry path. Bot3 Death #8: lava during flee.
                  if (isLavaBlock(block.name)) { hasSafeGround = false; break; }
                  // SAFETY: Treat water as unsafe — same as main flee direction check.
                  // Bot1/Bot2 [2026-03-23]: perpendicular retry routed into water → drowning.
                  if (isWaterBlock(block.name)) { hasSafeGround = false; break; }
                  if (block.name !== "air" && block.name !== "cave_air" && block.name !== "void_air") {
                    hasSafeGround = true; break;
                  }
                }
                if (!hasSafeGround) { safe = false; break; }
              }
              if (safe) {
                if (angleOffset > 0) {
                  perpAngle = testAngle;
                  console.error(`[Flee] Perpendicular retry: first direction unsafe, using opposite perpendicular.`);
                }
                retryDirSafe = true;
                break;
              }
            }
            if (!retryDirSafe) {
              if (retryElevated) {
                console.error(`[Flee] Perpendicular retry: both directions have cliff drops (elevated Y=${retryBy}) — proceeding with pathfinder descent.`);
              } else {
                console.error(`[Flee] Perpendicular retry: BOTH perpendicular directions unsafe (cliff/hole/lava). Reducing distance to 5 blocks.`);
                distance = Math.min(distance, 5);
              }
            }
          }

          const perpTarget = bot.entity.position.plus(
            new Vec3(Math.cos(perpAngle) * distance, 0, Math.sin(perpAngle) * distance)
          );
          const retryGoal = new goals.GoalNear(perpTarget.x, perpTarget.y, perpTarget.z, 3);
          if (bot.pathfinder.movements) {
            bot.pathfinder.movements.maxDropDown = fleeStartElevated ? 5 : 2;
            bot.pathfinder.movements.canDig = false;
            (bot.pathfinder.movements as any).liquidCost = 10000;
            bot.pathfinder.movements.allowSprinting = true;
          }
          bot.setControlState("sprint", true);
          const retryGoalHandle = safeSetGoal(bot, retryGoal, {
            onAbort: (yDescent) => {
              console.error(`[Flee] Perpendicular retry CAVE DESCENT: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
              try { bot.setControlState("sprint", false); } catch { /* ignore */ }
            }
          });
          await new Promise<void>((resolve) => {
            const retryTimeout = setTimeout(() => { retryGoalHandle.cleanup(); bot.pathfinder.setGoal(null); resolve(); }, 8000);
            const retryStartMs = Date.now();
            const retryCheck = setInterval(() => {
              if (retryGoalHandle.aborted) {
                clearInterval(retryCheck); clearTimeout(retryTimeout);
                resolve();
                return;
              }
              const retryElapsed = Date.now() - retryStartMs;
              if (retryElapsed > 1500 && !bot.pathfinder.isMoving()) {
                clearInterval(retryCheck); clearTimeout(retryTimeout);
                retryGoalHandle.cleanup(); bot.pathfinder.setGoal(null); resolve();
              }
            }, 300);
          });
          bot.setControlState("sprint", false);
          const retryDist = bot.entity.position.distanceTo(hostile.position);
          const retryMoved = bot.entity.position.distanceTo(startPos);
          console.error(`[Flee] Perpendicular retry result: hostile distance ${newDist.toFixed(1)} → ${retryDist.toFixed(1)}, total moved ${retryMoved.toFixed(1)}`);
          if (retryDist > newDist + 2) {
            // Retry succeeded — update return values
            return `Fled from ${fleeFromName}! Now ${retryDist.toFixed(1)} blocks away (was ${initialHostileDist.toFixed(1)}). Moved ${retryMoved.toFixed(1)} blocks (perpendicular retry). HP: ${(bot.health ?? 0).toFixed(1)}/20` + caveWarning;
          }
        } catch (retryErr) {
          console.error(`[Flee] Perpendicular retry failed: ${retryErr}`);
          bot.setControlState("sprint", false);
        }
        fleeFailWarning = ` [WARNING] Flee moved CLOSER to hostile (${initialHostileDist.toFixed(0)}→${newDist.toFixed(0)} blocks). Perpendicular retry attempted. Terrain is blocking escape routes. Try: dig 1x1x2 shelter hole, minecraft_pillar_up, or mc_navigate to specific safe coordinates instead.`;
      } else if (distMoved < distance * 0.3) {
        // Also warn when flee barely moved (less than 30% of requested distance)
        console.error(`[Flee] WARNING: Only fled ${distMoved.toFixed(1)} blocks (requested ${distance}). Terrain may be very constrained.`);
        fleeFailWarning = ` [WARNING] Only fled ${distMoved.toFixed(0)}/${distance} blocks. Terrain is constrained. Try: dig shelter, minecraft_pillar_up, or mc_navigate to specific coordinates.`;
      }

      // RANGED MOB WARNING: Pillagers, skeletons, strays can attack from 15+ blocks.
      // Even after a "successful" flee, the bot may still be in attack range of ranged mobs.
      // Bot2 [2026-03-23]: flee(40/50/60) against Pillager — distance stayed 12-20m,
      // Pillager continuously shot bot during and after each flee. Bot died at HP 2.7.
      // Warn the agent to use pillarUp or shelter instead of repeated flee against ranged mobs.
      const RANGED_MOB_NAMES = ["skeleton", "stray", "pillager", "drowned", "witch", "blaze"];
      let rangedWarning = "";
      if (newDist < 20) {
        const rangedNearby = allHostiles.filter(h =>
          RANGED_MOB_NAMES.includes(h.name.toLowerCase()) && h.dist < 20
        );
        if (rangedNearby.length > 0) {
          const rangedList = rangedNearby.map(h => `${h.name}(${bot.entity.position.distanceTo(h.entity.position).toFixed(0)}m)`).join(", ");
          rangedWarning = ` [URGENT] Ranged mob(s) still in attack range: ${rangedList}. Flee is ineffective against ranged mobs — they shoot while chasing. Use bot.pillarUp(4) to block line-of-sight, or dig 1x1x2 shelter hole immediately.`;
          console.error(`[Flee] RANGED MOB WARNING: ${rangedList} still within attack range after flee.`);
        }
      }

      return `Fled from ${fleeFromName}! Now ${newDist.toFixed(1)} blocks away (was ${initialHostileDist.toFixed(1)}). Moved ${distMoved.toFixed(1)} blocks. HP: ${(bot.health ?? 0).toFixed(1)}/20` + fleeFailWarning + rangedWarning + caveWarning;
    }
    // Warn when flee barely moved or didn't move at all — even without a known hostile.
    // Bot2 [2026-03-23]: flee(32) returned with 0 distance moved and no explanation.
    // The agent thought flee succeeded and continued waiting, when it should have tried
    // an alternative (pillarUp, dig shelter, navigate to specific coordinates).
    if (distMoved < distance * 0.3) {
      // EMERGENCY FALLBACK: When pathfinder completely fails to move, try raw control-state
      // movement as a last resort. This bypasses the pathfinder entirely — the bot simply
      // walks forward (away from the nearest threat) with jump for 2 seconds.
      // Bot2 [2026-03-23]: flee(32) at (-32.3, 98, 13.7) — pathfinder returned 0 distance.
      // pillarUp also failed. moveTo also failed. All pathfinder-based escape was blocked.
      // Raw movement ignores pathfinder's inability to find a valid node graph and forces
      // physical displacement, which may break the bot out of an isolated-node deadlock.
      if (distMoved < 1) {
        console.error(`[Flee] Pathfinder COMPLETELY stuck. Attempting raw control-state emergency escape...`);
        try {
          bot.pathfinder.setGoal(null);
          bot.clearControlStates();
          // Look away from nearest threat (or random direction if no threat)
          const escapeAngle = allHostiles.length > 0
            ? Math.atan2(
                bot.entity.position.z - allHostiles[0].entity.position.z,
                bot.entity.position.x - allHostiles[0].entity.position.x
              )
            : Math.random() * 2 * Math.PI;
          await bot.look(escapeAngle, 0, true);
          // Walk/sprint + jump forward for 2 seconds.
          // Bot2 [2026-03-23]: raw fallback enabled sprint at hunger=0, but Minecraft
          // requires hunger > 6 to sprint. At low hunger, the sprint control state is
          // ignored by the game engine, so only forward+jump actually moves the bot.
          // Enabling sprint at low hunger wastes the 2s window on a no-op sprint attempt.
          bot.setControlState("forward", true);
          if ((bot.food ?? 20) > 6) {
            bot.setControlState("sprint", true);
          }
          bot.setControlState("jump", true);
          await new Promise(r => setTimeout(r, 2000));
          bot.clearControlStates();
          const rawMoveDist = bot.entity.position.distanceTo(startPos);
          console.error(`[Flee] Raw escape moved ${rawMoveDist.toFixed(1)} blocks`);
          if (rawMoveDist > 1) {
            return `Fled ${rawMoveDist.toFixed(1)} blocks from ${fleeFromName} (emergency raw movement — pathfinder was stuck). HP: ${(bot.health ?? 0).toFixed(1)}/20` + caveWarning;
          }
        } catch (rawErr) {
          console.error(`[Flee] Raw escape failed: ${rawErr}`);
          bot.clearControlStates();
        }
      }
      const zeroWarn = distMoved < 1
        ? ` [WARNING] Flee FAILED — did not move. Pathfinder could not find any route. Try: dig 1x1x2 shelter hole, bot.pillarUp(), or bot.moveTo(specific coordinates).`
        : ` [WARNING] Only fled ${distMoved.toFixed(0)}/${distance} blocks. Terrain is very constrained. Try: dig shelter, bot.pillarUp(), or bot.moveTo(specific coordinates).`;
      return `Fled ${distMoved.toFixed(1)} blocks from ${fleeFromName}! HP: ${(bot.health ?? 0).toFixed(1)}/20` + zeroWarn + caveWarning;
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
        bot.pathfinder.movements.maxDropDown = 2; // restore safe default (2-block max drop)
        (bot.pathfinder.movements as any).liquidCost = 10000; // keep water avoidance
        bot.pathfinder.movements.allowSprinting = true; // restore default
        // Do NOT restore canDig=true — let the next moveTo decide based on time-of-day/HP.
        // Same rationale as the normal-exit path: restoring canDig=true at night defeats
        // the cave-routing protection in moveToBasic.
        // bot.pathfinder.movements.canDig stays at its current value (false from flee)
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
      if (!block || block.name === "air" || isWaterBlock(block.name) || block.hardness < 0) continue;
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
        if (checkBlock && isLavaBlock(checkBlock.name)) {
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
      if (!block || block.name === "air" || isWaterBlock(block.name) || isLavaBlock(block.name)) {
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
    // Threshold is 4 (not 8): tunneling is a low-HP-consumption activity (digging, not combat).
    // Session 83: tunnel("down") stopped at HP=7 with "HP too low" — too conservative.
    // The agent decides when to eat/flee; the API should only abort at truly critical HP.
    if (bot.health < 4) {
      console.error(`[Tunnel] HP critical (${bot.health}), stopping`);
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
    const reason = bot.health < 4 ? "HP critical" : "Movement/digging failed";
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
