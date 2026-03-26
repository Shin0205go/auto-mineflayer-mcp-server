import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
import type { ManagedBot } from "./types.js";
import { isHostileMob, isNeutralMob, isFoodItem, isBedBlock, isNearCliffEdge, EDIBLE_FOOD_NAMES } from "./minecraft-utils.js";
// bot-items functions are imported dynamically so that mc_reload cache-busting
// picks up the latest collectNearbyItems (inventoryBefore fix, sprint-through-item fix).
// Static import would keep the startup-version binding even after mc_reload.
// Bot1 Session 70: 627a514 fixed bot-items.ts but mc_reload x3 still 0 drops because
// collectNearbyItems was resolved from the cached static import, not the reloaded module.
import type { collectNearbyItems as CollectNearbyItemsFn, equipArmor as EquipArmorFn } from "./bot-items.js";

// Lazy accessor: returns bot-items module. Uses import() without query string on first call
// (module already loaded). After mc_reload bumps _botItemsVersion, import() returns the
// freshly loaded cache-busted version.
let _botItemsVersion = 0;
export function _setBotItemsVersion(v: number): void { _botItemsVersion = v; }
async function _getBotItems(): Promise<{ collectNearbyItems: typeof CollectNearbyItemsFn; equipArmor: typeof EquipArmorFn }> {
  if (_botItemsVersion > 0) {
    const base = new URL("./", import.meta.url).href;
    return await import(base + "bot-items.js?v=" + _botItemsVersion);
  }
  return await import("./bot-items.js");
}

// Convenience wrappers used throughout this file
async function collectNearbyItems(managed: Parameters<typeof CollectNearbyItemsFn>[0], options?: Parameters<typeof CollectNearbyItemsFn>[1]): Promise<string> {
  const { collectNearbyItems: fn } = await _getBotItems();
  return fn(managed, options);
}
async function equipArmor(bot: Parameters<typeof EquipArmorFn>[0]): Promise<string> {
  const { equipArmor: fn } = await _getBotItems();
  return fn(bot);
}
import { safeSetGoal } from "./pathfinder-safety.js";

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

// Track last successful sleep world-age tick per username for Phantom insomnia warnings.
// Phantoms spawn after 72000 ticks (3 in-game days) without sleeping.
// Exported so mc_status can read it; updated in sleep() on success.
export const lastSleepTick: Map<string, number> = new Map();

/**
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Apply safe pathfinder settings before any setGoal() in combat approach phases.
 * Without this, approach/chase movement uses whatever settings are currently active,
 * which may allow cave routing (canDig=true), water routing (liquidCost=default),
 * or cliff falls (maxDropDown too high).
 * Bot1 Sessions 31-44, Bot2, Bot3: multiple deaths during combat approach phases
 * because setGoal() was called without the safety settings that moveToBasic applies.
 */
function applySafePathfinderSettings(bot: Bot): void {
  if (!bot.pathfinder.movements) return;
  // ALWAYS disable canDig — pathfinder digging creates cave openings and underground routing.
  // Previously gated on night/low-HP, but daytime cave routing still killed bots at HP>=10.
  // Bot1/Bot2/Bot3 [2026-03-22]: multiple daytime deaths from canDig cave entry.
  bot.pathfinder.movements.canDig = false;
  bot.pathfinder.movements.maxDropDown = 2;
  (bot.pathfinder.movements as any).liquidCost = 10000;
  bot.pathfinder.movements.allowFreeMotion = false;
}

/**
 * Get brief status after an action (HP, hunger, position, surroundings, dangers)
 * Only returns status if APPEND_BRIEF_STATUS=true (for Mamba agent)
 */
function getBriefStatus(bot: Bot): string {
  if (!APPEND_BRIEF_STATUS) return "";

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
  const blocked: string[] = [];

  for (const [dir, [dx, dz]] of Object.entries(dirs)) {
    const feet = getBlock(dx, 0, dz);
    const head = getBlock(dx, 1, dz);
    const ground = getBlock(dx, -1, dz);
    const canWalk = (feet === "air" || feet === "water") && (head === "air" || head === "water");
    const hasGround = ground !== "air" && ground !== "water";

    if (canWalk && hasGround) {
      walkable.push(dir);
    } else if (!canWalk) {
      blocked.push(dir);
    }
  }

  // Check surroundings
  const below = getBlock(0, -1, 0);
  const above = getBlock(0, 2, 0);
  const blockBelow = below !== "air" && below !== "water" ? below : "none";
  const blockAbove = above !== "air" && above !== "water" ? above : "none";

  // Check nearby hostiles
  const hostiles = Object.values(bot.entities)
    .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
    .map(e => ({
      name: e.name || "unknown",
      dist: e.position.distanceTo(bot.entity.position),
    }))
    .filter(h => h.dist < 16)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);

  const hostileInfo = hostiles.length > 0
    ? ` Enemies: ${hostiles.map(h => `${h.name}(${h.dist.toFixed(1)}m)`).join(", ")}`
    : "";

  return ` [HP:${hp} Food:${food} @(${x},${y},${z}) Below:${blockBelow} Above:${blockAbove} Walk:${walkable.join("")||"none"} Block:${blocked.join("")||"none"}${hostileInfo}]`;
}

/**
 * Send a chat message
 */
export function chat(managed: ManagedBot, message: string): void {
  if (message.startsWith("/")) {
    console.error(`[Chat] BLOCKED slash command: ${message}`);
    return;
  }
  managed.bot.chat(message);
}

/**
 * Sleep in a bed
 */
export async function sleep(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;
  const minecraftData = await import("minecraft-data");
  const mcData = minecraftData.default(bot.version);

  // Find a bed nearby (dynamically get all bed block IDs from registry)
  const bedBlockIds = Object.values(mcData.blocksByName)
    .filter(b => isBedBlock(b.name))
    .map(b => b.id);

  let bedBlock = bot.findBlock({
    matching: bedBlockIds,
    maxDistance: 32,
  });

  if (!bedBlock) {
    throw new Error("No bed found within 32 blocks. Craft a bed with 3 wool + 3 planks.");
  }

  // Move close to the bed before sleeping
  const goal = new goals.GoalNear(
    bedBlock.position.x,
    bedBlock.position.y,
    bedBlock.position.z,
    1
  );
  bot.pathfinder.setGoal(goal);
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 10000);
    bot.once("goal_reached", () => { clearTimeout(timeout); resolve(); });
  });

  // Wait a moment for position to stabilize
  await delay(500);

  // Re-find the bed block after moving (block reference may be stale)
  bedBlock = bot.findBlock({
    matching: bedBlockIds,
    maxDistance: 6,
  });

  if (!bedBlock) {
    throw new Error("Moved toward bed but it's no longer nearby. Try again.");
  }

  // If still too far from the bed, walk directly toward it
  const dist = bot.entity.position.distanceTo(bedBlock.position);
  if (dist > 3) {
    const goal2 = new goals.GoalBlock(
      bedBlock.position.x,
      bedBlock.position.y,
      bedBlock.position.z
    );
    bot.pathfinder.setGoal(goal2);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 8000);
      bot.once("goal_reached", () => { clearTimeout(timeout); resolve(); });
    });
    await delay(500);
  }

  // Try sleeping in available beds (skip occupied ones)
  const nearbyBeds = bot.findBlocks({
    matching: bedBlockIds,
    maxDistance: 6,
    count: 10,
  });

  const tryBeds = [bedBlock.position, ...nearbyBeds.filter(p =>
    p.x !== bedBlock!.position.x || p.y !== bedBlock!.position.y || p.z !== bedBlock!.position.z
  )];

  for (const bedPos of tryBeds) {
    const bed = bot.blockAt(bedPos);
    if (!bed) continue;
    try {
      await bot.sleep(bed);
      await delay(5000);
      // Record successful sleep tick for phantom insomnia tracking.
      // bot.time.age is the world age in ticks — phantoms spawn after 72000 ticks
      // (3 in-game days) since last sleep.
      const sleepAge = bot.time?.age ?? 0;
      lastSleepTick.set(managed.username, sleepAge);
      console.error(`[Sleep] Recorded last sleep at world tick ${sleepAge} for ${managed.username}`);
      return "Slept through the night. It's now morning!";
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("occupied")) {
        continue;
      }
      if (errMsg.includes("monsters")) {
        return "Cannot sleep - there are monsters nearby!";
      }
      throw new Error(`Failed to sleep: ${errMsg}`);
    }
  }

  return "All nearby beds are occupied. Try another bed or wait.";
}

/**
 * Attack a single entity
 */
export async function attack(managed: ManagedBot, entityName?: string): Promise<string> {
  const bot = managed.bot;

  // Auto-equip best armor and weapon before attacking
  try { await equipArmor(bot); } catch (_) { /* ignore armor equip errors */ }

  const weaponPriority = [
    "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
  ];
  for (const weaponName of weaponPriority) {
    const weapon = bot.inventory.items().find(i => i.name === weaponName);
    if (weapon) {
      try { await bot.equip(weapon, "hand"); } catch (_) { /* ignore equip errors */ }
      break;
    }
  }

  // Find target
  let target: any = null;
  const entities = Object.values(bot.entities);

  if (entityName) {
    const targetLower = entityName.toLowerCase();
    // Determine if the requested target is itself a hostile mob
    const targetIsHostile = isHostileMob(bot, targetLower);
    target = entities.find(e => {
      if (!e || e === bot.entity) return false;
      const dist = e.position.distanceTo(bot.entity.position);
      if (dist > 64) return false;

      const name = (e.name || "").toLowerCase();
      const displayName = ((e as any).displayName || "").toLowerCase();

      // Exact match always OK
      if (name === targetLower || displayName === targetLower) return true;

      // Substring match: exclude hostile mobs when targeting passive ones,
      // AND exclude neutral mobs (zombified_piglin) from all substring matches.
      // Bot3 Deaths #1,#9,#16: fight("zombie") substring-matched "zombified_piglin",
      // provoking the entire group. Neutral mobs require exact-name match only.
      const substringMatch = name.includes(targetLower) || displayName.includes(targetLower);
      if (substringMatch && !targetIsHostile && isHostileMob(bot, name)) {
        return false; // e.g. "pig" should not match "zombified_piglin"
      }
      if (substringMatch && isNeutralMob(name)) {
        return false; // e.g. "zombie" should not match "zombified_piglin"
      }
      return substringMatch;
    });
  } else {
    // Find nearest hostile (using dynamic registry check)
    // Apply underground penalty (5 per block below bot Y-5) consistent with fight().
    // Without this, attack() targets underground hostiles, causing cave routing and deaths.
    // Bot1/Bot2/Bot3 [2026-03-22]: multiple deaths from targeting underground mobs.
    const attackBotY = bot.entity.position.y;
    target = entities
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .sort((a, b) => {
        const aDist = a.position.distanceTo(bot.entity.position);
        const bDist = b.position.distanceTo(bot.entity.position);
        const aDepth = Math.max(attackBotY - a.position.y - 5, 0);
        const bDepth = Math.max(attackBotY - b.position.y - 5, 0);
        return (aDist + aDepth * 5) - (bDist + bDepth * 5);
      })[0];
  }

  // Retry with delay if no target found — entities may still be loading after chunk changes.
  if (!target && entityName) {
    console.error(`[Attack] No ${entityName} found on first attempt — waiting 600ms for entity loading...`);
    await delay(600);
    // Re-scan entities
    const retryEntities = Object.values(bot.entities);
    const retryLower = entityName.toLowerCase();
    const retryIsHostile = isHostileMob(bot, retryLower);
    target = retryEntities.find(e => {
      if (!e || e === bot.entity) return false;
      const dist = e.position.distanceTo(bot.entity.position);
      if (dist > 64) return false;
      const name = (e.name || "").toLowerCase();
      const displayName = ((e as any).displayName || "").toLowerCase();
      if (name === retryLower || displayName === retryLower) return true;
      const substringMatch = name.includes(retryLower) || displayName.includes(retryLower);
      if (substringMatch && !retryIsHostile && isHostileMob(bot, name)) return false;
      if (substringMatch && isNeutralMob(name)) return false;
      return substringMatch;
    }) || null;
  }

  if (!target) {
    return entityName
      ? `No ${entityName} found within attack range`
      : "No hostile mobs nearby to attack";
  }

  let distance = target.position.distanceTo(bot.entity.position);

  // Enderman strategy: approach to ~12 blocks if far, then stare to provoke
  if (target.name === "enderman" && distance > 4 && distance <= 64) {
    // If enderman is far, approach to ~12 blocks first for reliable provocation
    if (distance > 16) {
      console.error(`[Attack] Enderman at ${distance.toFixed(1)} blocks — approaching to 12 blocks first...`);
      applySafePathfinderSettings(bot);
      const approachGoal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 12);
      // Use safeSetGoal for Y-descent monitoring during approach.
      // Previous raw setGoal() had no cave routing protection — bot could descend
      // into caves while approaching enderman, same issue fixed in fight() enderman path.
      const attackApproachHandle = safeSetGoal(bot, approachGoal, {
        intervalMs: 200,
        elevationAware: true,
        onAbort: (yDescent) => {
          console.error(`[Attack] CAVE DESCENT during enderman approach: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
        }
      });
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { attackApproachHandle.cleanup(); bot.pathfinder.setGoal(null); resolve(); }, 8000);
        const check = setInterval(() => {
          if (attackApproachHandle.aborted) {
            clearInterval(check); clearTimeout(timeout); resolve();
            return;
          }
          const currentDist = target.position.distanceTo(bot.entity.position);
          if (currentDist <= 14 || !bot.pathfinder.isMoving()) {
            clearInterval(check); clearTimeout(timeout); attackApproachHandle.cleanup(); bot.pathfinder.setGoal(null); resolve();
          }
        }, 200);
      });
      distance = target.position.distanceTo(bot.entity.position);
    }

    console.error(`[Attack] Enderman at ${distance.toFixed(1)} blocks — provoking by staring at eyes...`);
    // Look at the enderman's eye level to provoke it
    await bot.lookAt(target.position.offset(0, target.height * 0.9, 0));
    // Wait for it to come to us (angry enderman will teleport close and attack)
    for (let i = 0; i < 50; i++) { // 50 * 300ms = 15s max wait (extended for reliable aggro)
      await new Promise(r => setTimeout(r, 300));
      // Keep looking at the enderman
      const currentTarget = Object.values(bot.entities).find(e => e.id === target.id);
      if (!currentTarget) break; // enderman died or despawned
      await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.9, 0));
      const currentDist = currentTarget.position.distanceTo(bot.entity.position);
      if (currentDist < 8) {
        console.error(`[Attack] Enderman aggro'd, now ${currentDist.toFixed(1)} blocks away — attacking!`);
        target = currentTarget;
        break;
      }
    }
    distance = target.position.distanceTo(bot.entity.position);
  }

  // Blaze strategy: approach quickly, eat aggressively during approach (they shoot fireballs)
  if (target.name === "blaze" && distance > 3.5) {
    console.error(`[Attack] Blaze at ${distance.toFixed(1)} blocks — rushing to melee range...`);
    // Eat before approaching if not full HP (fireballs deal damage during approach).
    // Use EDIBLE_FOOD_NAMES to avoid spider_eye poison at low HP.
    if (bot.health < 18 && bot.food < 20) {
      const food = bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
      if (food) {
        try { await bot.equip(food, "hand"); await bot.consume(); } catch (_) {}
        // Re-equip weapon after eating
        for (const wn of ["netherite_sword", "diamond_sword", "iron_sword", "stone_sword"]) {
          const w = bot.inventory.items().find(i => i.name === wn);
          if (w) { try { await bot.equip(w, "hand"); } catch (_) {} break; }
        }
      }
    }
    // Sprint toward blaze
    applySafePathfinderSettings(bot);
    bot.setControlState("sprint", true);
    const blazeGoal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2);
    bot.pathfinder.setGoal(blazeGoal);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve(); }, 10000);
      const check = setInterval(() => {
        const currentTarget = Object.values(bot.entities).find(e => e.id === target.id);
        if (!currentTarget) { clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve(); return; }
        // Update goal to track blaze movement (they fly around)
        const newDist = currentTarget.position.distanceTo(bot.entity.position);
        if (newDist < 3.5 || !bot.pathfinder.isMoving()) {
          clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve();
        } else {
          // Re-target if blaze moved significantly
          bot.pathfinder.setGoal(new goals.GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, 2));
        }
      }, 300);
    });
    distance = target.position.distanceTo(bot.entity.position);
  }

  // End Crystal strategy: use bow to shoot crystals on top of obsidian pillars (they are high up)
  if (target.name === "end_crystal") {
    const heightDiff = target.position.y - bot.entity.position.y;
    const bow = bot.inventory.items().find(i => i.name === "bow");
    const arrows = bot.inventory.items().find(i => i.name === "arrow");

    if (heightDiff > 3 && bow && arrows) {
      console.error(`[Attack] End Crystal is ${heightDiff.toFixed(1)} blocks above — using bow attack`);
      try {
        await bot.equip(bow, "hand");
        let crystalDestroyed = false;
        for (let shot = 0; shot < 7; shot++) {
          // Check if crystal still exists
          const crystalCheck = Object.values(bot.entities).find(e => e.id === target.id);
          if (!crystalCheck) { crystalDestroyed = true; break; }

          // Aim at crystal center
          await bot.lookAt(crystalCheck.position.offset(0, crystalCheck.height * 0.5, 0));
          bot.activateItem();
          await delay(1200); // Draw bow
          bot.deactivateItem();
          await delay(500); // Arrow flight time
          console.error(`[Attack] Bow shot ${shot + 1}/7 at End Crystal`);
        }

        // Re-equip melee weapon
        for (const wn of weaponPriority) {
          const w = bot.inventory.items().find(i => i.name === wn);
          if (w) { try { await bot.equip(w, "hand"); } catch (_) {} break; }
        }

        if (crystalDestroyed) {
          return `Destroyed End Crystal with bow after ${7} shots`;
        }
        // Fall through to melee if bow didn't work (crystal too resilient or moved)
        console.error(`[Attack] Bow shots done, checking if crystal destroyed...`);
        const stillExists = Object.values(bot.entities).find(e => e.id === target.id);
        if (!stillExists) return `Destroyed End Crystal with bow`;
        // Continue with melee fallback
      } catch (err) {
        console.error(`[Attack] Bow attack failed: ${err}, falling back to melee`);
      }
    }
  }

  // Move closer if needed
  if (distance > 3) {
    // Ranged mob approach strategy: skeletons, pillagers, strays maintain 10-15 block distance
    // and back away as bot approaches. Standard GoalNear(2) causes infinite chase until timeout.
    // Bot1 [2026-03-22]: mc_combat("skeleton") always times out because skeleton retreats.
    // Fix: sprint toward ranged mobs and re-target every 500ms to track their retreat path.
    // Also abort approach if HP drops significantly (taking damage during approach with no check).
    const RANGED_APPROACH_MOBS = ["skeleton", "stray", "pillager", "drowned", "witch"];
    const isRangedMob = RANGED_APPROACH_MOBS.includes((target.name || "").toLowerCase());
    const approachStartHp = bot.health ?? 20;
    console.error(`[Attack] Target ${target.name} is ${distance.toFixed(1)} blocks away, moving closer...${isRangedMob ? " (ranged mob — sprint approach)" : ""}`);
    applySafePathfinderSettings(bot);
    if (isRangedMob) {
      bot.pathfinder.movements.allowSprinting = true;
      bot.setControlState("sprint", true);
    }
    const goal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2);
    // Use mutable handle so ranged retargets can replace it with new safeSetGoal monitors.
    // Previously retargets called raw bot.pathfinder.setGoal(), which overrode the safeSetGoal
    // monitor and destroyed Y-descent tracking. After the first retarget (500ms), the bot
    // could descend into caves with no abort. Now each retarget creates a new monitored goal.
    // Bot1/Bot2/Bot3 [2026-03-22]: multiple deaths from underground routing during combat approach.
    let attackGoalHandle = safeSetGoal(bot, goal, {
      elevationAware: true,
      onAbort: (yDescent) => {
        console.error(`[Attack] CAVE DESCENT during approach: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
      }
    });

    // Scale timeout based on distance (1s per 4 blocks, min 5s, max 20s)
    // Ranged mobs get shorter timeout (10s max) — if we can't close in 10s, abort
    const approachTimeout = isRangedMob
      ? Math.min(10000, Math.max(5000, Math.ceil(distance / 4) * 1000))
      : Math.min(20000, Math.max(5000, Math.ceil(distance / 4) * 1000));
    // Wait for movement with proper tracking
    let approachAbortReason = "";
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, approachTimeout);

      let lastRetargetTime = Date.now();
      const check = setInterval(() => {
        // Re-check target position (it may have moved)
        const currentTarget = Object.values(bot.entities).find(e => e.id === target.id);
        if (!currentTarget) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
          return;
        }
        const currentDist = currentTarget.position.distanceTo(bot.entity.position);

        // HP monitoring during approach: abort if taking significant damage.
        // Bot1/Bot2: took 10+ damage during approach with no abort, died before reaching target.
        const approachHp = bot.health ?? 20;
        if (approachHp < approachStartHp - 6 || approachHp < 8) {
          console.error(`[Attack] HP dropped during approach (${approachStartHp.toFixed(1)} → ${approachHp.toFixed(1)}). Aborting.`);
          approachAbortReason = `HP dropped from ${approachStartHp.toFixed(1)} to ${approachHp.toFixed(1)} during approach`;
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
          return;
        }

        if (attackGoalHandle.aborted) {
          approachAbortReason = `Cave descent detected during approach`;
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
          return;
        }

        if (currentDist < 3.5 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
          return;
        }

        // Ranged mobs: re-target every 500ms to track their retreat path.
        // Clean up old safeSetGoal monitor before creating a new one — raw setGoal
        // would destroy Y-descent monitoring, allowing cave routing during retarget.
        if (isRangedMob && Date.now() - lastRetargetTime > 500) {
          lastRetargetTime = Date.now();
          try {
            attackGoalHandle.cleanup();
            const retargetGoal = new goals.GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, 2);
            attackGoalHandle = safeSetGoal(bot, retargetGoal, {
              elevationAware: true,
              onAbort: (yDescent) => {
                console.error(`[Attack] CAVE DESCENT during ranged retarget: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
              }
            });
          } catch { /* ignore */ }
        }
      }, 200);
    });

    attackGoalHandle.cleanup();
    // Clean up sprint state after approach
    if (isRangedMob) {
      bot.setControlState("sprint", false);
    }

    if (approachAbortReason) {
      const abortHp = (bot.health ?? 0).toFixed(1);
      return `[ABORTED] Attack approach stopped — ${approachAbortReason}. HP=${abortHp}/20. Use mc_eat to heal or mc_flee to escape.`;
    }

    distance = target.position.distanceTo(bot.entity.position);

    // BOW FALLBACK: If ranged mob is still far after approach, use bow attack.
    // Bot1 [2026-03-22]: mc_combat("skeleton") always timed out because skeletons
    // retreat faster than the bot can chase. After sprint approach, skeleton is still
    // at 8-15 blocks. Instead of entering melee loop (which will timeout chasing),
    // use bow if available. This matches the end_crystal bow strategy above.
    // Bow deals 6-10 damage (fully charged) — kills most mobs in 2-3 shots.
    if (isRangedMob && distance > 5) {
      const bow = bot.inventory.items().find(i => i.name === "bow" || i.name === "crossbow");
      const arrows = bot.inventory.items().find(i => i.name === "arrow" || i.name === "spectral_arrow" || i.name === "tipped_arrow");
      if (bow && arrows) {
        console.error(`[Attack] Ranged mob ${target.name} still at ${distance.toFixed(1)} blocks after approach. Using bow (${bow.name}).`);
        let bowLastPos = target.position.clone();
        try {
          await bot.equip(bow, "hand");
          let bowKill = false;
          for (let shot = 0; shot < 7; shot++) {
            const bowTarget = Object.values(bot.entities).find(e => e.id === target.id);
            if (!bowTarget) { bowKill = true; break; }
            // HP check during bow fight
            if (bot.health <= 12) {
              console.error(`[Attack] HP low (${bot.health}) during bow fight. Stopping.`);
              break;
            }
            bowLastPos = bowTarget.position.clone();
            // Lead the shot slightly — aim at center mass
            await bot.lookAt(bowTarget.position.offset(0, bowTarget.height * 0.6, 0));
            bot.activateItem(); // Start drawing bow
            await delay(bow.name === "crossbow" ? 1250 : 1000); // Draw time
            // Re-aim right before release (target may have moved)
            const reTarget = Object.values(bot.entities).find(e => e.id === target.id);
            if (reTarget) {
              await bot.lookAt(reTarget.position.offset(0, reTarget.height * 0.6, 0));
              bowLastPos = reTarget.position.clone();
            }
            bot.deactivateItem(); // Release arrow
            await delay(400); // Arrow flight time
            console.error(`[Attack] Bow shot ${shot + 1}/7 at ${target.name}`);
          }
          // Re-equip melee weapon
          for (const wn of weaponPriority) {
            const w = bot.inventory.items().find(i => i.name === wn);
            if (w) { try { await bot.equip(w, "hand"); } catch (_) {} break; }
          }
          if (bowKill) {
            // Collect drops
            try {
              const distToDrops = bot.entity.position.distanceTo(bowLastPos);
              if (distToDrops > 3) {
                applySafePathfinderSettings(bot);
                const collectGoal = new goals.GoalNear(bowLastPos.x, bowLastPos.y, bowLastPos.z, 2);
                const bowCollectHandle = safeSetGoal(bot, collectGoal, {
                  elevationAware: true,
                  onAbort: (yDescent) => {
                    console.error(`[Attack] CAVE DESCENT during bow kill collection: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
                  }
                });
                await new Promise<void>((resolve) => {
                  const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 5000);
                  const check = setInterval(() => {
                    if (bowCollectHandle.aborted) {
                      clearInterval(check); clearTimeout(timeout); resolve();
                      return;
                    }
                    if (bot.entity.position.distanceTo(bowLastPos) < 3 || !bot.pathfinder.isMoving()) {
                      clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
                    }
                  }, 200);
                });
                bowCollectHandle.cleanup();
              }
              const bowInventoryBefore = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
              await delay(800);
              await collectNearbyItems(managed, { inventoryBefore: bowInventoryBefore });
            } catch (_) {}
            const inv = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
            return `Killed ${target.name} with ${bow.name}. HP: ${(bot.health ?? 0).toFixed(1)}/20. Inventory: ${inv}`;
          }
          // If bow didn't kill, fall through to melee loop
          const bowTarget = Object.values(bot.entities).find(e => e.id === target.id);
          if (bowTarget) {
            distance = bowTarget.position.distanceTo(bot.entity.position);
            target = bowTarget;
          }
        } catch (bowErr) {
          console.error(`[Attack] Bow attack failed: ${bowErr}, falling back to melee`);
          // Re-equip melee weapon
          for (const wn of weaponPriority) {
            const w = bot.inventory.items().find(i => i.name === wn);
            if (w) { try { await bot.equip(w, "hand"); } catch (_) {} break; }
          }
        }
      }
    }
  }

  // Attack repeatedly until entity is dead or too far
  const targetId = target.id;
  let attacks = 0;
  const maxAttacks = 20; // Safety limit (20 attacks should kill most mobs)
  let lastKnownTargetPos = target.position.clone();
  const attackStartTime = Date.now();
  const ATTACK_TIMEOUT_MS = 60000; // 60s max — prevents infinite pathfinder loops

  // Multi-hostile escalation: count nearby hostiles and raise flee threshold.
  // Bot2 [2026-03-23]: killed by zombie while fighting enderman — fleeAtHp=12 was too low
  // with 2+ mobs dealing simultaneous damage. Two zombies deal ~6 damage per hit cycle,
  // meaning HP 12 → 6 in one tick — often lethal before flee completes.
  // fight() has this via fleeAtHp parameter from mc_combat; attack() was missing it.
  let attackFleeHp = 12;
  const nearbyHostileCount = Object.values(bot.entities).filter(e => {
    if (!e || e === bot.entity || !e.position) return false;
    const eName = (e.name || "").toLowerCase();
    if (!isHostileMob(bot, eName)) return false;
    return e.position.distanceTo(bot.entity.position) < 16;
  }).length;
  if (nearbyHostileCount >= 3) {
    attackFleeHp = 16;
    console.error(`[Attack] ${nearbyHostileCount} hostiles nearby — raised fleeHp to ${attackFleeHp}`);
  } else if (nearbyHostileCount >= 2) {
    attackFleeHp = 14;
    console.error(`[Attack] ${nearbyHostileCount} hostiles nearby — raised fleeHp to ${attackFleeHp}`);
  }

  try {
    while (attacks < maxAttacks) {
      // Global timeout check
      if (Date.now() - attackStartTime > ATTACK_TIMEOUT_MS) {
        console.error(`[Attack] Global timeout (${ATTACK_TIMEOUT_MS / 1000}s) reached after ${attacks} attacks. Aborting.`);
        bot.pathfinder.setGoal(null);
        return `Attack timed out after ${attacks} attacks. Target may be unreachable.`;
      }
      // Check HP - flee if low. Threshold is dynamic based on nearby hostile count.
      // Bug fix: previously this just returned "Fled" without actually fleeing — bot stayed
      // in place next to the hostile mob. Now actually moves away using pathfinder.
      // Bot1 [2026-03-22]: "Fled from skeleton" but skeleton kept shooting because bot didn't move.
      if (bot.health <= attackFleeHp) {
        console.error(`[Attack] HP low (${bot.health}), fleeing from ${target.name}!`);
        bot.pathfinder.setGoal(null);
        // Try to eat food before fleeing. Use EDIBLE_FOOD_NAMES to avoid spider_eye poison.
        const food = bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
        if (food) {
          try {
            await bot.equip(food, "hand");
            bot.deactivateItem();
            await bot.consume();
          } catch (_) { /* ignore eat errors during flee */ }
        }
        // Actually flee: move away from the hostile mob (20 blocks).
        // fight() calls flee() properly; attack() was missing this, leaving bot in danger.
        try {
          const { flee: fleeFunc } = await import("./bot-movement.js");
          await fleeFunc(managed, 20);
        } catch (fleeErr) {
          console.error(`[Attack] Flee failed: ${fleeErr}`);
        }
        return `Fled from ${target.name} at low HP (${bot.health}/20) after ${attacks} attacks. Eat food and try again.`;
      }

      // Mid-combat auto-eat: if HP dropped below 14 and food is available, eat between attacks.
      // Previously only worked for blaze targets. Bot1 [2026-03-22]: mc_combat("skeleton")
      // timed out at 60s — skeleton dealt continuous ranged damage but bot never ate mid-combat.
      // fight() already has this for all mobs; attack() was missing it for non-blaze targets.
      if (bot.health < 14 && attacks > 0 && attacks % 3 === 0) {
        // Use EDIBLE_FOOD_NAMES to avoid spider_eye poison mid-combat.
        const midAttackFood = bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
        if (midAttackFood) {
          try {
            bot.pathfinder.setGoal(null); // Stop moving while eating
            await bot.equip(midAttackFood, "hand");
            await bot.consume();
            console.error(`[Attack] Mid-combat auto-ate ${midAttackFood.name} (HP: ${bot.health})`);
            // Re-equip weapon after eating
            for (const wn of weaponPriority) {
              const w = bot.inventory.items().find(i => i.name === wn);
              if (w) { try { await bot.equip(w, "hand"); } catch (_) {} break; }
            }
          } catch (_) { /* ignore eat errors — continue fighting */ }
        }
      }

      // Creeper proximity check: abort if creeper within 12 blocks during non-creeper combat.
      // fight() has this check but attack() was missing it.
      // Bot1 Sessions 24, 27, 30, 33: creeper explosions while fighting other mobs.
      // Creepers approach silently during combat — must detect and flee immediately.
      if (target.name !== "creeper") {
        const nearbyCreeper = Object.values(bot.entities).find(e => {
          if (!e || e === bot.entity || !e.position) return false;
          const eName = e.name?.toLowerCase() ?? "";
          if (!eName.includes("creeper")) return false;
          return e.position.distanceTo(bot.entity.position) < 12;
        });
        if (nearbyCreeper) {
          const creeperDist = nearbyCreeper.position.distanceTo(bot.entity.position).toFixed(1);
          console.error(`[Attack] Creeper detected ${creeperDist}m away during ${target.name} combat! Aborting!`);
          bot.pathfinder.setGoal(null);
          return `[CREEPER ABORT] Creeper detected ${creeperDist}m away during ${target.name} combat. Attacked ${attacks} times. Use mc_flee to escape creeper first.`;
        }
      }

      // Check if target still exists
      const currentTarget = Object.values(bot.entities).find(e => e.id === targetId);
      if (!currentTarget) {
        // Auto-collect dropped items after kill
        // Capture inventory snapshot BEFORE navigation to drop position.
        // Bug [Session 78]: previously captured after navigation, so items auto-collected
        // during the walk to lastKnownTargetPos were already in inventoryBefore,
        // causing collectNearbyItems to report actuallyCollected=0.
        const attackInventoryAtKill = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
        const attackSnapshotAtKill = new Map<string, number>();
        for (const ai of bot.inventory.items()) {
          attackSnapshotAtKill.set(ai.name, (attackSnapshotAtKill.get(ai.name) || 0) + ai.count);
        }
        // Move to last known position first (endermen teleport, drops spawn where they died)
        const distToLastPos = bot.entity.position.distanceTo(lastKnownTargetPos);
        if (distToLastPos > 3) {
          console.error(`[Attack] Target died ${distToLastPos.toFixed(1)} blocks away, moving to last known pos to collect drops`);
          applySafePathfinderSettings(bot);
          // Relax maxDropDown for item collection: drops can land 1-2 blocks below kill position.
          if (bot.pathfinder.movements) {
            bot.pathfinder.movements.maxDropDown = 3;
          }
          const collectGoal = new goals.GoalNear(lastKnownTargetPos.x, lastKnownTargetPos.y, lastKnownTargetPos.z, 2);
          const collectHandle = safeSetGoal(bot, collectGoal, {
            elevationAware: true,
            onAbort: (yDescent) => {
              console.error(`[Attack] CAVE DESCENT during item collection: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
            }
          });
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 5000);
            const check = setInterval(() => {
              if (collectHandle.aborted) {
                clearInterval(check); clearTimeout(timeout); resolve();
                return;
              }
              if (bot.entity.position.distanceTo(lastKnownTargetPos) < 3 || !bot.pathfinder.isMoving()) {
                clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
              }
            }, 200);
          });
          collectHandle.cleanup();
        }
        // Wait for server to spawn drop item entities before collection.
        // Endermen teleport — wider search. All mobs get 1s minimum to ensure entity spawn.
        // Bot2/Bot3 [2026-03-22]: mob drops not collected because item entities hadn't
        // spawned yet (800ms too short on busy server). Increased to 1s for all mobs.
        const isEnderman = target.name === "enderman";
        // Use attackInventoryAtKill (captured before nav) as inventoryBefore for collectNearbyItems.
        // This ensures items auto-collected during navigation are counted as gained.
        const attackInventoryBefore = attackInventoryAtKill;
        await delay(isEnderman ? 1000 : 1000);
        let collectionResult = "Collection not attempted";
        try {
          // Wider search for endermen (teleport, items scatter far).
          // Default 10-block radius with waitRetries=10 for all mobs to catch delayed spawns.
          const attackCollectOpts = isEnderman
            ? { searchRadius: 16, waitRetries: 12, inventoryBefore: attackInventoryBefore }
            : { searchRadius: 12, waitRetries: 10, inventoryBefore: attackInventoryBefore };
          collectionResult = await collectNearbyItems(managed, attackCollectOpts);
          console.error(`[Attack] Item collection result: ${collectionResult}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Attack] CRITICAL: Item collection failed after kill: ${errMsg}`);
        }

        // Compute actual items gained from kill (vs inventory at kill time).
        const attackInvAfter = bot.inventory.items();
        const attackItemsGained: string[] = [];
        for (const ai of attackInvAfter) {
          const before = attackSnapshotAtKill.get(ai.name) || 0;
          const gained = ai.count - before;
          if (gained > 0) attackItemsGained.push(`${ai.name} x${gained}`);
        }
        const attackTotalGained = attackInvAfter.reduce((sum, i) => sum + i.count, 0) - attackInventoryAtKill;
        if (attackTotalGained > 0 && (collectionResult.includes("No items") || collectionResult.includes("unchanged") || collectionResult.includes("0 items"))) {
          collectionResult = `Gained ${attackTotalGained} item(s): ${attackItemsGained.join(", ")} (auto-collected during approach)`;
          console.error(`[Attack] CORRECTED collection result: ${collectionResult}`);
        } else if (attackTotalGained > 0) {
          collectionResult += ` [Total gained: ${attackItemsGained.join(", ")}]`;
        }

        // AUTO-EAT after kill when HP/hunger is low and food is available.
        // attack() targets the nearest hostile — after killing it, the bot may have food
        // in inventory (from previous collections or this kill's drops). Eating immediately
        // restores HP/hunger before the agent decides on the next action.
        // Bot2 [2026-03-22]: killed zombie, had food in inventory, HP=5 — didn't eat.
        {
          const postAttackHp = bot.health ?? 20;
          const postAttackHunger = (bot as any).food ?? 20;
          if (postAttackHp < 16 || postAttackHunger < 14) {
            const postAttackFood = bot.inventory.items().find((i: any) => EDIBLE_FOOD_NAMES.has(i.name));
            if (postAttackFood) {
              try {
                await bot.equip(postAttackFood, "hand");
                await bot.consume();
                console.error(`[Attack] Auto-ate ${postAttackFood.name} after kill (HP: ${postAttackHp.toFixed(1)} → ${(bot.health ?? 0).toFixed(1)}, hunger: ${postAttackHunger} → ${(bot as any).food ?? "?"})`);
                collectionResult += ` [Auto-ate ${postAttackFood.name}]`;
              } catch (_) {
                console.error(`[Attack] Auto-eat failed after kill`);
              }
            }
          }
        }

        return `Killed ${target.name} after ${attacks} attacks. Items: ${collectionResult}`;
      }
      // Track last known position (important for teleporting mobs like endermen)
      lastKnownTargetPos = currentTarget.position.clone();

      // Check if target is too far - if so, chase it instead of giving up
      const currentDist = currentTarget.position.distanceTo(bot.entity.position);
      if (currentDist > 6) {
        // Endermen can be chased further (they teleport but usually stay within 64 blocks)
        const maxChaseDistance = currentTarget.name === "enderman" ? 64 : 32;
        if (currentDist > maxChaseDistance) {
          // Too far to chase
          return `Target ${target.name} escaped after ${attacks} attacks (distance: ${currentDist.toFixed(1)} blocks)`;
        }

        console.error(`[Attack] Target ${target.name} moved to ${currentDist.toFixed(1)} blocks, chasing...`);
        applySafePathfinderSettings(bot);
        const chaseGoal = new goals.GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, 2);
        // Use safeSetGoal for chase — raw setGoal bypassed Y-descent monitoring,
        // allowing the bot to chase targets into caves. Bot1/Bot2/Bot3 [2026-03-22]:
        // multiple deaths from underground routing during combat chase loops.
        const chaseHandle = safeSetGoal(bot, chaseGoal, {
          elevationAware: true,
          onAbort: (yDescent) => {
            console.error(`[Attack] CAVE DESCENT during chase: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
          }
        });

        // Chase duration scales with distance, endermen get longer chase
        const chaseDuration = currentTarget.name === "enderman" ? 5000 : 2000;
        const chaseStartHp = bot.health ?? 20;
        let chaseAbortReason = "";
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            bot.pathfinder.setGoal(null);
            resolve();
          }, chaseDuration);

          const check = setInterval(() => {
            if (chaseHandle.aborted) {
              chaseAbortReason = `Cave descent detected during chase`;
              clearInterval(check);
              clearTimeout(timeout);
              resolve();
              return;
            }
            const checkDist = currentTarget.position.distanceTo(bot.entity.position);
            if (checkDist < 3.5 || !bot.pathfinder.isMoving()) {
              clearInterval(check);
              clearTimeout(timeout);
              bot.pathfinder.setGoal(null);
              resolve();
              return;
            }
            // HP monitoring during chase: abort if taking significant damage.
            // Bot1/Bot2/Bot3 [2026-03-22]: multiple deaths during 2-5s chase loops
            // with NO HP check — skeletons/creepers dealt lethal damage undetected.
            // The approach loop (line ~480) has this check but the chase loop did not.
            const chaseHp = bot.health ?? 20;
            if (chaseHp < chaseStartHp - 4 || chaseHp < 10) {
              console.error(`[Attack] HP dropped during chase (${chaseStartHp.toFixed(1)} → ${chaseHp.toFixed(1)}). Aborting chase.`);
              chaseAbortReason = `HP dropped from ${chaseStartHp.toFixed(1)} to ${chaseHp.toFixed(1)} during chase`;
              clearInterval(check);
              clearTimeout(timeout);
              bot.pathfinder.setGoal(null);
              resolve();
              return;
            }
            // Creeper proximity during chase — creepers approach silently and explode.
            // Bot1 Sessions 24,27: creeper exploded during combat movement.
            if (target.name !== "creeper") {
              for (const e of Object.values(bot.entities)) {
                if (!e || e === bot.entity || !e.position) continue;
                if (e.name?.toLowerCase() === "creeper" && e.position.distanceTo(bot.entity.position) < 10) {
                  console.error(`[Attack] Creeper detected during chase! Aborting.`);
                  chaseAbortReason = `Creeper at ${e.position.distanceTo(bot.entity.position).toFixed(1)}m during chase`;
                  clearInterval(check);
                  clearTimeout(timeout);
                  bot.pathfinder.setGoal(null);
                  resolve();
                  return;
                }
              }
            }
          }, 100);
        });

        chaseHandle.cleanup();

        if (chaseAbortReason) {
          const abortHp = (bot.health ?? 0).toFixed(1);
          return `[ABORTED] Chase stopped — ${chaseAbortReason}. HP=${abortHp}/20. Use mc_eat to heal or mc_flee to escape.`;
        }

        // Continue to attack after chasing
        continue;
      }

      // Mid-combat eat for blaze is now handled by the generic mid-combat eat above (all mobs).

      // Attack
      await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.8, 0));
      bot.attack(currentTarget);
      attacks++;

      // Wait for attack cooldown (Minecraft 1.9+ has attack cooldown)
      // Diamond sword has ~0.6s cooldown, but 700ms was too slow allowing health regen
      // Reduced to 650ms for faster kills
      await delay(650);
    }

    return `Attacked ${target.name} ${attacks} times (may not be dead, stopped at safety limit)`;
  } catch (err) {
    return `Failed to attack after ${attacks} attempts: ${err}`;
  }
}

/**
 * Fight an entity until it dies or we need to flee
 * Handles: equip weapon, approach, attack loop, health check
 */
export async function fight(
  managed: ManagedBot,
  flee: (managed: ManagedBot, distance: number) => Promise<string>,
  entityName?: string,
  fleeHealthThreshold: number = 12
): Promise<string> {
  const bot = managed.bot;
  const fightFuncStartTime = Date.now();

  // Multi-hostile escalation: count nearby hostiles and raise flee threshold.
  // attack() already has this (line ~654), but fight() was missing it.
  // Bot2 [2026-03-23]: fleeAtHp=5 during enderman fight, zombie attacked from behind,
  // HP dropped below 5 in one tick from simultaneous hits — bot died before flee triggered.
  // Two mobs deal ~6-10 damage per hit cycle, so fleeAtHp must account for burst damage.
  // Bot1/Bot2/Bot3: many deaths where fight() used the raw caller fleeAtHp while surrounded.
  //
  // EXCEPTION: food-desperate passive mob hunts. When the bot has no food and hunger <= 6,
  // and is targeting a food animal (cow, pig, chicken, etc.), the multi-hostile escalation
  // must be capped to avoid a starvation deadlock:
  //   1. mc_combat("cow") sets fleeAtHp=8 (food-desperate cap in core-tools.ts)
  //   2. fight() raises fleeHealthThreshold to 14-16 (multi-hostile escalation)
  //   3. HP 1.8 <= 16 → immediate flee → never hunts cow → never gets food → death
  // Bot1 [2026-03-23]: bot.combat("cow", 15) "instant completion" — fight() raised threshold
  // to 16, HP 1.8 triggered immediate flee before any attack. Bot couldn't get food.
  // Fix: detect food-desperate state and cap escalation at the caller's threshold.
  const FOOD_ANIMALS_FIGHT = ["cow", "pig", "chicken", "sheep", "rabbit", "mooshroom", "goat", "salmon", "cod"];
  const isFoodAnimalTarget = entityName && FOOD_ANIMALS_FIGHT.some(a => entityName.toLowerCase().includes(a));
  const hasNoFood = !bot.inventory.items().some(i => EDIBLE_FOOD_NAMES.has(i.name));
  const hungerLevel = (bot as any).food ?? 20;
  const isFoodDesperateFight = isFoodAnimalTarget && hasNoFood && hungerLevel <= 6;

  const nearbyHostileCountFight = Object.values(bot.entities).filter(e => {
    if (!e || e === bot.entity || !e.position) return false;
    const eName = (e.name || "").toLowerCase();
    if (!isHostileMob(bot, eName)) return false;
    return e.position.distanceTo(bot.entity.position) < 16;
  }).length;
  if (isFoodDesperateFight) {
    // Food-desperate: don't escalate beyond caller's threshold. The caller (mc_combat)
    // already set a food-desperate cap (typically 8). Escalating further creates deadlock.
    console.error(`[Fight] FOOD DESPERATE: ${nearbyHostileCountFight} hostiles nearby but targeting food animal "${entityName}" with no food, hunger=${hungerLevel}. Keeping fleeHealthThreshold=${fleeHealthThreshold} (no escalation).`);
  } else if (isFoodAnimalTarget) {
    // Passive mob hunt: do NOT escalate flee threshold based on nearby hostiles.
    // Bot1/Bot2/Bot3 [2026-03-23]: combat("cow") with 2+ hostiles within 16 blocks
    // raised fleeHealthThreshold to 14-16, causing immediate flee at HP 10-14.
    // The mid-combat hostile abort (5-block check) provides safety during passive hunts.
    // Escalating the flee threshold makes passive hunting impossible at night when
    // hostiles are always nearby. Keep the caller's threshold (typically 10).
    console.error(`[Fight] Passive mob hunt "${entityName}": ${nearbyHostileCountFight} hostiles nearby but NOT escalating fleeHealthThreshold (keeping ${fleeHealthThreshold}). Mid-combat hostile abort provides safety.`);
  } else if (nearbyHostileCountFight >= 3) {
    fleeHealthThreshold = Math.max(fleeHealthThreshold, 16);
    console.error(`[Fight] ${nearbyHostileCountFight} hostiles nearby — raised fleeHealthThreshold to ${fleeHealthThreshold}`);
  } else if (nearbyHostileCountFight >= 2) {
    fleeHealthThreshold = Math.max(fleeHealthThreshold, 14);
    console.error(`[Fight] ${nearbyHostileCountFight} hostiles nearby — raised fleeHealthThreshold to ${fleeHealthThreshold}`);
  }

  // Step 0: Auto-eat before combat if HP is not full and food is available.
  // Use EDIBLE_FOOD_NAMES (not isFoodItem) to exclude spider_eye which causes 2 HP poison
  // damage — eating it mid-combat at low HP is often lethal. isFoodItem includes spider_eye
  // because it IS technically edible, but EDIBLE_FOOD_NAMES is the curated safe-to-eat list.
  if (bot.health < 16 && bot.food < 20) {
    const foodItem = bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
    if (foodItem) {
      try {
        await bot.equip(foodItem, "hand");
        await bot.consume();
        console.error(`[Fight] Auto-ate ${foodItem.name} before combat (HP: ${bot.health}, hunger: ${bot.food})`);
      } catch (_) { /* ignore eat errors */ }
    }
  }

  // Step 1: Equip best armor and weapon
  try { await equipArmor(bot); } catch (_) { /* ignore armor equip errors */ }

  const weaponPriority = [
    "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
    "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
  ];
  const inventory = bot.inventory.items();
  for (const weaponName of weaponPriority) {
    const weapon = inventory.find(i => i.name === weaponName);
    if (weapon) {
      await bot.equip(weapon, "hand");
      console.error(`[BotManager] Equipped ${weaponName}`);
      break;
    }
  }

  // Step 2: Find target (using dynamic hostile check)
  const findTarget = () => {
    const entities = Object.values(bot.entities);
    if (entityName) {
      const targetLower = entityName.toLowerCase();
      // Determine if the requested target is itself a hostile mob
      const targetIsHostile = isHostileMob(bot, targetLower);

      const candidates = entities.filter(e => {
        if (!e || e === bot.entity) return false;
        const dist = e.position.distanceTo(bot.entity.position);
        if (dist > 64) return false;

        // Check various name properties
        const eName = e.name?.toLowerCase() || "";
        const eDisplayName = (e as any).displayName?.toLowerCase() || "";
        const eUsername = (e as any).username?.toLowerCase() || "";

        // Exact match is always OK
        const exactMatch = eName === targetLower ||
               eDisplayName === targetLower ||
               eUsername === targetLower;
        if (exactMatch) return true;

        // For substring matching: if target is a passive mob name, do NOT match
        // hostile mobs that happen to contain the target string (e.g. "pig" in "zombified_piglin").
        // Also reject neutral mobs (zombified_piglin) from ALL substring matches —
        // "zombie" must not match "zombified_piglin" (provoking the swarm is lethal).
        // Bot3 Deaths #1,#9,#16: fight("zombie") substring-matched zombified_piglin.
        const substringMatch = eName.includes(targetLower) || eDisplayName.includes(targetLower);
        if (substringMatch) {
          if (!targetIsHostile && isHostileMob(bot, eName)) {
            // Requested passive "pig" should not match hostile "zombified_piglin"
            return false;
          }
          if (isNeutralMob(eName)) {
            // Neutral mobs require exact name match — never auto-target via substring
            return false;
          }
          return true;
        }
        return false;
      });
      if (candidates.length === 0) return null;
      // Return best match with surface preference: penalize underground entities.
      // Bot1 Sessions 31-34,44, Bot3 #3: mc_combat(target="cow") picked underground
      // entity as closest, bot navigated into cave, got trapped and died.
      // Penalty: +3 per block below bot Y (beyond 5-block tolerance).
      const combatBotY = bot.entity.position.y;
      return candidates.sort((a, b) => {
        const aDist = a.position.distanceTo(bot.entity.position);
        const bDist = b.position.distanceTo(bot.entity.position);
        const aDepth = Math.max(combatBotY - a.position.y - 5, 0);
        const bDepth = Math.max(combatBotY - b.position.y - 5, 0);
        // Penalty 5 per block underground: matches findBlock and navigate entity scoring.
        // Bot1/Bot2/Bot3 [2026-03-22]: combat targeted underground mobs because 3x penalty
        // was weaker than findBlock's 5x, making combat route into caves more aggressively.
        return (aDist + aDepth * 5) - (bDist + bDepth * 5);
      })[0];
    }
    // Apply depth penalty to unnamed hostile targeting — same rationale as the named-entity
    // path above. Without this, the bot targets underground hostiles (caves, ravines),
    // navigates underground, and gets trapped/killed.
    // Bot1 Sessions 31-44, Bot2, Bot3: deaths from targeting underground hostiles.
    const unnamedBotY = bot.entity.position.y;
    return entities
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .sort((a, b) => {
        const aDist = a.position.distanceTo(bot.entity.position);
        const bDist = b.position.distanceTo(bot.entity.position);
        const aDepth = Math.max(unnamedBotY - a.position.y - 5, 0);
        const bDepth = Math.max(unnamedBotY - b.position.y - 5, 0);
        // Penalty 5 per block: consistent with findBlock/navigate entity scoring.
        return (aDist + aDepth * 5) - (bDist + bDepth * 5);
      })[0] || null;
  };

  let target = findTarget();
  // Retry with delay if no target found — entities may still be loading after navigation/chunk changes.
  // Bot1/Bot2 [2026-03-23]: bot.navigate("cow") succeeded, then bot.combat("cow") returned
  // "No cow found nearby" instantly. The cow entity was not yet in bot.entities because
  // chunk entity loading has a 1-2 tick delay after pathfinder arrives at destination.
  if (!target && entityName) {
    console.error(`[Fight] No ${entityName} found on first attempt — waiting 600ms for entity loading...`);
    await delay(600);
    target = findTarget();
    if (!target) {
      // Second retry with wider entity scan — mob may have wandered during navigation
      console.error(`[Fight] Still no ${entityName} after retry. Scanning loaded entities...`);
      await delay(400);
      target = findTarget();
    }
  }
  if (!target) {
    const elapsed = ((Date.now() - fightFuncStartTime) / 1000).toFixed(1);
    console.error(`[Fight] RESULT: No target found (${elapsed}s)`);
    return entityName
      ? `No ${entityName} found nearby`
      : "No hostile mobs nearby";
  }

  const targetName = target.name || "entity";
  let targetId = target.id;
  let attackCount = 0;
  const maxAttacks = 30; // Safety limit
  let lastKnownFightPos = target.position.clone();

  console.error(`[BotManager] Starting fight with ${targetName} (id=${target.id}) at ${target.position.distanceTo(bot.entity.position).toFixed(1)} blocks, HP=${bot.health?.toFixed(1)}, fleeThreshold=${fleeHealthThreshold}, isFoodDesperate=${isFoodDesperateFight}`);

  // Passive mob chase phase: navigate closer before entering combat loop.
  // Passive mobs (cow, pig, sheep, etc.) wander at ~1-2 blocks/s. The combat loop's
  // 1.6s approach ticks are too short to close distance on a moving passive mob at 10+ blocks.
  // Bot1/Bot2 [2026-03-23]: combat("cow") timed out because approach iterations couldn't
  // close the gap on a wandering cow. Use proper pathfinder navigation (up to 10s) to get
  // within 8 blocks before entering the melee combat loop.
  // Only for passive/food animals — hostile mobs should use the existing cautious approach.
  {
    const chaseDistance = target.position.distanceTo(bot.entity.position);
    const CHASE_PASSIVE_MOBS = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey",
      "mule", "mooshroom", "llama", "goat", "salmon", "cod", "squid", "turtle", "fox"];
    const isPassiveChase = entityName && CHASE_PASSIVE_MOBS.some(a => entityName.toLowerCase().includes(a));
    // CRITICAL FIX [2026-03-23]: Lowered chase threshold from 8 to 4 blocks.
    // At 5-8 blocks, the combat loop's approach phase (4s ticks) often couldn't close
    // the gap on wandering passive mobs before they moved again. The chase phase uses
    // proper pathfinder navigation (up to 10s) which reliably closes distance.
    // Bot1/Bot2/Bot3: combat("cow") at 5-8 blocks entered approach-retreat cycle.
    if (isPassiveChase && chaseDistance > 4) {
      console.error(`[Fight] Passive mob ${targetName} at ${chaseDistance.toFixed(1)} blocks — chasing with pathfinder (up to 10s)...`);
      applySafePathfinderSettings(bot);
      bot.pathfinder.movements.allowSprinting = true;
      bot.setControlState("sprint", true);
      const chaseGoal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2);
      const chaseHandle = safeSetGoal(bot, chaseGoal, {
        intervalMs: 200,
        elevationAware: true,
        onAbort: (yDescent) => {
          console.error(`[Fight] CAVE DESCENT during passive chase: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
        }
      });
      const chaseStart = Date.now();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { chaseHandle.cleanup(); bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve(); }, 10000);
        const check = setInterval(() => {
          if (chaseHandle.aborted) {
            clearInterval(check); clearTimeout(timeout); bot.setControlState("sprint", false); resolve();
            return;
          }
          // Re-find the target (it moves) and update goal
          const curTarget = Object.values(bot.entities).find(e => e.id === targetId);
          if (!curTarget) {
            // Target disappeared — try to re-find by name
            const refound = findTarget();
            if (refound) {
              targetId = refound.id;
              target = refound;
              bot.pathfinder.setGoal(new goals.GoalNear(refound.position.x, refound.position.y, refound.position.z, 2));
            } else {
              clearInterval(check); clearTimeout(timeout); chaseHandle.cleanup(); bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve();
              return;
            }
          } else {
            const curDist = curTarget.position.distanceTo(bot.entity.position);
            // Chase exits at 3.5 blocks (attack range) — guarantees immediate attack on next loop
            if (curDist <= 3.5) {
              clearInterval(check); clearTimeout(timeout); chaseHandle.cleanup(); bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve();
              return;
            }
            // Update goal to track moving mob (every 1s)
            if ((Date.now() - chaseStart) % 1000 < 200) {
              bot.pathfinder.setGoal(new goals.GoalNear(curTarget.position.x, curTarget.position.y, curTarget.position.z, 2));
            }
            target = curTarget;
          }
          // HP safety during chase
          const chaseHp = bot.health ?? 20;
          const chaseFleeThreshold = isFoodDesperateFight ? 2 : fleeHealthThreshold;
          if (chaseHp <= chaseFleeThreshold) {
            console.error(`[Fight] HP dropped to ${chaseHp.toFixed(1)} during passive chase. Aborting.`);
            clearInterval(check); clearTimeout(timeout); chaseHandle.cleanup(); bot.pathfinder.setGoal(null); bot.setControlState("sprint", false); resolve();
          }
        }, 200);
      });
      // Re-find target after chase
      target = Object.values(bot.entities).find(e => e.id === targetId) || findTarget();
      if (target) {
        targetId = target.id;
        lastKnownFightPos = target.position.clone();
        console.error(`[Fight] After chase: ${targetName} now at ${target.position.distanceTo(bot.entity.position).toFixed(1)} blocks`);
      } else {
        return `No ${entityName || targetName} found after chase — target moved out of range` + getBriefStatus(bot);
      }
    }
  }

  // Null safety: target should always be non-null here, but TypeScript needs assurance
  if (!target) {
    return entityName
      ? `No ${entityName} found nearby`
      : "No hostile mobs nearby";
  }

  // SAFETY: Cliff-edge check before combat — knockback from melee or ranged mobs can
  // push bot off cliff edges, causing fatal fall damage regardless of HP.
  // Bot1 Session 21b: "doomed to fall by Skeleton" during combat on elevated terrain.
  // Bot2 [2026-03-22]: "doomed to fall by Pillager/Skeleton" — knockback fall deaths.
  //
  // EXCEPTION: passive mobs (cow, pig, sheep, chicken, etc.) do NOT knock back the bot,
  // so cliff-edge REFUSED is irrelevant and only blocks legitimate food-animal hunts on
  // elevated terrain (e.g. Y=108 mountain top). Skip cliff check for passive targets.
  // For hostile mobs: raise threshold from >4 to >15 — a 5-15 block drop on a mountain
  // is unlikely to be lethal (e.g. Y=108 plateau with nearby ledge at Y=104 triggers at 4
  // blocks even though the actual terrain is safe). Only refuse at truly lethal heights.
  if (!isFoodAnimalTarget) {
    const cliffCheck = isNearCliffEdge(bot);
    if (cliffCheck.nearEdge && cliffCheck.maxFallDistance > 15) {
      console.error(`[Fight] CLIFF EDGE DETECTED: ${cliffCheck.maxFallDistance}-block drop (${cliffCheck.edgeDirections.join(",")}). Combat knockback is lethal. Refusing to fight.`);
      return `[REFUSED] Too dangerous to fight ${targetName} — you are near a cliff edge with a ${cliffCheck.maxFallDistance}-block drop (directions: ${cliffCheck.edgeDirections.join(", ")}). Combat knockback can push you off the edge, causing fatal fall damage. Move away from the cliff first (mc_navigate to safer terrain), then engage.`;
    }
  }

  // Enderman strategy: approach to ~12 blocks if far, then stare to provoke
  let fightDistance = target.position.distanceTo(bot.entity.position);
  if (targetName === "enderman" && fightDistance > 4 && fightDistance <= 64) {
    // Approach closer first if far away for reliable provocation
    if (fightDistance > 16) {
      console.error(`[Fight] Enderman at ${fightDistance.toFixed(1)} blocks — approaching to 12 blocks first...`);
      applySafePathfinderSettings(bot);
      const enderGoalHandle = safeSetGoal(bot,
        new goals.GoalNear(target!.position.x, target!.position.y, target!.position.z, 12),
        {
          intervalMs: 200,
          elevationAware: true,
          onAbort: (yDescent) => {
            console.error(`[Fight] CAVE DESCENT during enderman approach: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
          }
        }
      );
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { enderGoalHandle.cleanup(); bot.pathfinder.setGoal(null); resolve(); }, 8000);
        const check = setInterval(() => {
          if (enderGoalHandle.aborted) {
            clearInterval(check); clearTimeout(timeout); resolve();
            return;
          }
          const currentDist = target!.position.distanceTo(bot.entity.position);
          if (currentDist <= 14 || !bot.pathfinder.isMoving()) {
            clearInterval(check); clearTimeout(timeout); enderGoalHandle.cleanup(); bot.pathfinder.setGoal(null); resolve();
          }
        }, 200);
      });
    }

    console.error(`[Fight] Enderman at ${target!.position.distanceTo(bot.entity.position).toFixed(1)} blocks — provoking by staring at eyes...`);
    for (let i = 0; i < 50; i++) { // 50 * 300ms = 15s max wait
      await new Promise(r => setTimeout(r, 300));
      const currentTarget = Object.values(bot.entities).find(e => e.id === targetId);
      if (!currentTarget) break;
      await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.9, 0));
      if (currentTarget.position.distanceTo(bot.entity.position) < 8) {
        console.error(`[Fight] Enderman aggro'd, now close — attacking!`);
        break;
      }
    }
  }

  // SAFETY: HP re-check after approach phase before entering combat loop.
  // During approach (especially enderman at up to 64 blocks), bot may take damage from
  // other mobs, starvation, or fall damage. Without this check, the combat loop starts
  // at dangerously low HP and the first combat hit is fatal.
  // Bot3 Deaths #9,#16: HP dropped to 2.2-7.2 during approach, entered combat loop, died.
  //
  // EXCEPTION: food-desperate passive mob hunts — if the bot has no food and is targeting
  // a food animal, it MUST fight even at low HP. Without this exception, the bot enters
  // a starvation deadlock: can't fight cow (HP too low) → can't get food → HP drops → death.
  // Bot1 [2026-03-23]: HP=1.8, hunger=0, combat("cow") fled instantly because postApproachHp <= threshold.
  // For food-desperate hunts, only abort at HP <= 2 (absolute minimum survivable).
  {
    const postApproachHp = bot.health ?? 20;
    // CRITICAL FIX [2026-03-25]: Use strict < (not <=) for the food-desperate threshold.
    // Minecraft's minimum HP is exactly 0.5 (death at 0). When the bot has HP=2.0 exactly
    // (from starvation: hunger=0 reduces HP to half-heart = 1.0 in 1.21, or ~2 in older versions),
    // using <= 2 triggered this flee immediately — the bot could NEVER fight a food animal at HP=2.
    // This was the root cause of "combat(cow) returns immediately" at low HP in Sessions 58-65.
    //
    // Session 84-85 deadlock: bot reaches HP=1.3 with hunger=0 and no food. The old threshold
    // of 2 meant combat("cow") always aborted (1.3 < 2). This created a permanent deadlock:
    // HP too low to fight → no food → HP can't recover. Lower food-desperate threshold to 1.0
    // (the absolute minimum survivable HP in Minecraft). The bot MUST fight at HP>1.0 when
    // food-desperate — dying is preferable to an infinite deadlock.
    const foodDesperateAbortThreshold = isFoodDesperateFight ? 1.0 : fleeHealthThreshold;
    const shouldFlee = isFoodDesperateFight
      ? postApproachHp <= foodDesperateAbortThreshold  // at HP=1.0 (minimum), flee
      : postApproachHp <= foodDesperateAbortThreshold; // <= for normal case
    if (shouldFlee) {
      const reason = isFoodDesperateFight
        ? `HP dropped to ${postApproachHp.toFixed(1)} — even food-desperate hunt too risky at minimum HP.`
        : `HP dropped to ${postApproachHp.toFixed(1)} during approach (flee threshold: ${fleeHealthThreshold}).`;
      console.error(`[Fight] ${reason} Fleeing instead of fighting.`);
      bot.pathfinder.setGoal(null);
      await flee(managed, 20);
      return `Fled before combat! ${reason} Attacked 0 times.` + getBriefStatus(bot);
    }
    if (isFoodDesperateFight && postApproachHp <= fleeHealthThreshold) {
      console.error(`[Fight] FOOD DESPERATE: HP=${postApproachHp.toFixed(1)} is below normal flee threshold (${fleeHealthThreshold}), but continuing food hunt for survival.`);
    }
  }

  // Step 3: Combat loop (with global timeout to prevent infinite hang)
  const fightStartTime = Date.now();
  // Ranged mobs get shorter timeout (30s): they deal continuous damage while unreachable.
  // Bot1 [2026-03-22]: skeleton at 10.8m unreachable, bot took 60s of arrow damage before timeout.
  // Melee mobs keep 60s — they don't deal damage unless adjacent.
  const RANGED_NAMES = ["skeleton", "stray", "pillager", "drowned", "witch", "blaze"];
  const isRangedFight = RANGED_NAMES.includes((target.name || "").toLowerCase());
  const FIGHT_TIMEOUT_MS = isRangedFight ? 30000 : 60000;
  let approachStallCount = 0; // Track consecutive approach iterations without closing distance
  // Initialize from actual distance, not Infinity. Starting at Infinity means the first
  // approach iteration always counts as "progress" (real distance < Infinity), wasting one
  // stall detection cycle. For ranged mobs with a 3-iteration threshold, this means the
  // stall abort fires at 4 iterations instead of 3 — an extra ~0.5s of arrow damage.
  // Bot1 [2026-03-22]: skeleton at 10.8m caused 60s timeout; faster stall detection helps.
  let lastApproachDist = target.position.distanceTo(bot.entity.position);
  let loopIteration = 0;
  while (attackCount < maxAttacks) {
    loopIteration++;
    console.error(`[Fight] Loop iteration #${loopIteration}: attackCount=${attackCount}, elapsed=${((Date.now() - fightStartTime)/1000).toFixed(1)}s, HP=${bot.health?.toFixed(1)}, targetId=${targetId}`);

    // Global timeout check
    if (Date.now() - fightStartTime > FIGHT_TIMEOUT_MS) {
      console.error(`[Fight] Global timeout (${FIGHT_TIMEOUT_MS / 1000}s) reached after ${attackCount} attacks. Aborting.`);
      bot.pathfinder.setGoal(null);
      // Clean up sprint state — may have been set for ranged mob approach.
      try { bot.setControlState("sprint", false); } catch { /* ignore */ }
      return `Fight timed out after ${attackCount} attacks (${FIGHT_TIMEOUT_MS / 1000}s). Target may be unreachable.` + getBriefStatus(bot);
    }

    // Check health - flee if low
    // EXCEPTION: food-desperate hunts use HP <= 0.5 threshold (Minecraft minimum HP is 0.5,
    // so this is effectively "never flee during food-desperate hunt").
    // At HP 1.0-1.8 with no food, fleeing just delays starvation death — the only survival
    // path is killing a food animal and eating its drops. Previous threshold of 2.0 caused
    // HP=1.5 to trigger immediate flee before any attack (1.5 <= 2.0), making combat("cow")
    // return instantly with 0 attacks and 0 drops — same as the HP 1.8 bug it was meant to fix.
    // Bot1 Sessions 61-64: combat("cow") returned immediately, no food collected, bot died.
    // Bot1 [2026-03-23]: HP=1.8, hunger=0, combat("cow") fled immediately because
    // HP 1.8 < fleeAtHp 8. Bot never got food, died from starvation.
    const health = bot.health;
    // When hunting a food animal with no food in inventory, use threshold=0.5 (Minecraft minimum HP)
    // regardless of hunger level. Without food drops, starvation death is certain — fleeing now
    // just delays the inevitable and leaves the bot with nothing to eat.
    // isFoodDesperateFight already covers hunger<=6, but hunger can be 7-20 while having NO food
    // (e.g., bot used up all food regen from prior hunger, now hunger=7 and inventory empty).
    // Bot1 Sessions 61-64: HP=1.5, no food, combat("cow") fled at threshold=10 before landing
    // any attack. isFoodAnimalTarget && hasNoFood covers this case regardless of hunger level.
    const isNoFoodAnimalHunt = isFoodAnimalTarget && hasNoFood;
    const effectiveFleeThreshold = (isFoodDesperateFight || isNoFoodAnimalHunt) ? 0.5 : fleeHealthThreshold;
    if (health <= effectiveFleeThreshold) {
      const thresholdNote = isFoodDesperateFight ? " (food-desperate threshold: 0.5)" : isNoFoodAnimalHunt ? " (no-food animal hunt threshold: 0.5)" : "";
      console.error(`[BotManager] Health low (${health}), fleeing!${thresholdNote}`);
      bot.pathfinder.setGoal(null);
      // Clean up sprint state before flee — flee sets its own sprint control.
      try { bot.setControlState("sprint", false); } catch { /* ignore */ }
      await flee(managed, 20);
      return `Fled! Health was ${health}. Attacked ${attackCount} times.` + getBriefStatus(bot);
    }

    // Mid-combat auto-eat: if HP dropped below 14 and food is available, eat between attacks.
    // Bot1 [2026-03-22]: mc_combat("skeleton") timed out at 60s — skeleton dealt continuous
    // damage from 15+ blocks during the approach loop. Pre-combat eat happens once, but a
    // prolonged fight (30-60s) with ranged mobs drains HP faster than the flee threshold triggers.
    // Eating mid-combat costs ~1.5s but restores 6-8 HP, often the difference between survival and death.
    if (health < 14 && attackCount > 0) {
      // Use EDIBLE_FOOD_NAMES to avoid eating spider_eye (causes 2 HP poison at low HP).
      const midCombatFood = bot.inventory.items().find((item: any) => EDIBLE_FOOD_NAMES.has(item.name));
      if (midCombatFood) {
        try {
          bot.pathfinder.setGoal(null); // Stop moving while eating
          await bot.equip(midCombatFood, "hand");
          await bot.consume();
          console.error(`[Fight] Mid-combat auto-ate ${midCombatFood.name} (HP: ${health.toFixed(1)} → ${bot.health?.toFixed(1)})`);
          // Re-equip weapon after eating
          const weaponPriorityMid = [
            "netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword",
            "netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe",
          ];
          for (const wn of weaponPriorityMid) {
            const w = bot.inventory.items().find(i => i.name === wn);
            if (w) { await bot.equip(w, "hand"); break; }
          }
        } catch (_) { /* ignore eat errors — continue fighting */ }
      }
    }

    // Creeper proximity check: flee if any creeper is within 12 blocks during combat.
    // Bot1 Sessions 24, 27, 30, 33: creeper explosions while fighting other mobs.
    // Creepers sneak up during combat movement — must detect and flee immediately.
    // Radius raised from 8 to 12: bot1 Session 27 had creeper at 11.8 blocks that exploded
    // because bot moved toward zombie (closing distance) and creeper approached simultaneously.
    if (targetName !== "creeper") {
      const nearbyCreeper = Object.values(bot.entities).find(e => {
        if (!e || e === bot.entity || !e.position) return false;
        const eName = e.name?.toLowerCase() ?? "";
        if (!eName.includes("creeper")) return false;
        return e.position.distanceTo(bot.entity.position) < 12;
      });
      if (nearbyCreeper) {
        const creeperDist = nearbyCreeper.position.distanceTo(bot.entity.position).toFixed(1);
        console.error(`[Fight] Creeper detected ${creeperDist}m away during ${targetName} combat! Emergency flee!`);
        bot.pathfinder.setGoal(null);
        await flee(managed, 20);
        return `[CREEPER ABORT] Fled from creeper (${creeperDist}m away) during ${targetName} combat. Attacked ${attackCount} times. Re-engage after creeper leaves.` + getBriefStatus(bot);
      }
    }

    // Mid-combat hostile check when fighting PASSIVE mobs (cow, pig, sheep, etc.).
    // Bot1 Session 16: killed by zombie while fighting sheep.
    // Bot3 Deaths #1, #3, #5: killed by hostile mobs during passive mob hunts.
    // When the bot moves toward a passive target, it may enter hostile mob range.
    //
    // CRITICAL FIX [2026-03-23]: Previous 12-block abort radius was too aggressive — made
    // passive mob hunting nearly impossible. Any hostile within 12 blocks (very common)
    // caused immediate abort on the FIRST combat loop iteration, before the bot could ever
    // land an attack. This completely blocked food acquisition from animals.
    // combat("cow") would return in ~1s with "HOSTILE ABORT, Attacked 0 times" every time.
    //
    // New strategy:
    // - Food-desperate (no food + hunger <= 6): SKIP hostile abort entirely. The bot dies
    //   from starvation if it can't kill the food animal. A zombie hit is survivable; starving isn't.
    // - Already within attack range (distance <= 3.5): finish the kill first, then flee.
    //   A cow has 10 HP, takes 2-3 sword hits (~2s). Fleeing mid-kill wastes the approach.
    // - Otherwise: only abort when hostile is within 5 blocks (actual melee danger range).
    //   At 5 blocks, zombie reaches melee in ~2s — enough time for 1-2 attacks on the cow.
    //   Previous 12-block radius meant hostiles that would never reach the bot caused aborts.
    if (entityName) {
      const passiveFoodMobs = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey", "mule", "mooshroom", "llama", "goat", "salmon", "cod", "squid", "turtle"];
      const isPassiveHunt = passiveFoodMobs.some(p => entityName.toLowerCase().includes(p));
      if (isPassiveHunt && !isFoodDesperateFight) {
        // Check distance to passive target — if we're already in attack range, prioritize killing
        const distToTarget = target ? target.position.distanceTo(bot.entity.position) : 999;
        const alreadyInRange = distToTarget <= 3.5; // melee range (passive mobs are never blaze)

        // CRITICAL FIX [2026-03-23]: Don't abort on the first loop iteration before any
        // approach has been attempted. The pre-combat hostile check in mc_combat already
        // warned the agent. Aborting on iteration 1 means combat("cow") returns in <1s
        // with "HOSTILE ABORT, Attacked 0 times" every single time at night.
        // Bot1/Bot2/Bot3: combat("cow/pig/chicken/sheep") all completed in ~1s because
        // hostile abort triggered on the very first loop iteration before approach started.
        // Allow at least 2 approach iterations (8-10s) before hostile-abort can trigger.
        // The HP flee check (line above) still protects against actual damage.
        const minIterationsBeforeAbort = 2;

        if (!alreadyInRange && loopIteration > minIterationsBeforeAbort) {
          const nearbyHostile = Object.values(bot.entities).find(e => {
            if (!e || e === bot.entity || !e.position) return false;
            const eName = e.name?.toLowerCase() ?? "";
            if (!isHostileMob(bot, eName)) return false;
            // Only abort when hostile is within actual melee danger range (4 blocks).
            // Reduced from 5 to 4: at 5 blocks, the hostile is still 1-2s away from
            // melee range. 4 blocks means it's about to attack — genuine emergency.
            return e.position.distanceTo(bot.entity.position) < 4;
          });
          if (nearbyHostile) {
            const hostileName = nearbyHostile.name ?? "hostile";
            const hostileDist = nearbyHostile.position.distanceTo(bot.entity.position).toFixed(1);
            console.error(`[Fight] Hostile ${hostileName} at ${hostileDist}m during ${entityName} hunt (iteration #${loopIteration})! Aborting to flee.`);
            bot.pathfinder.setGoal(null);
            await flee(managed, 20);
            return `[HOSTILE ABORT] Fled from ${hostileName} (${hostileDist}m away) during ${entityName} hunt. Attacked ${attackCount} times. Clear hostiles first, then re-hunt.` + getBriefStatus(bot);
          }
        } else if (!alreadyInRange && loopIteration <= minIterationsBeforeAbort) {
          // Log but don't abort on early iterations
          const earlyHostile = Object.values(bot.entities).find(e => {
            if (!e || e === bot.entity || !e.position) return false;
            const eName = e.name?.toLowerCase() ?? "";
            if (!isHostileMob(bot, eName)) return false;
            return e.position.distanceTo(bot.entity.position) < 4;
          });
          if (earlyHostile) {
            console.error(`[Fight] Hostile ${earlyHostile.name} at ${earlyHostile.position.distanceTo(bot.entity.position).toFixed(1)}m during ${entityName} hunt, but skipping abort on early iteration #${loopIteration} (need ${minIterationsBeforeAbort}+ iterations).`);
          }
        }
      }
    }

    // Multi-hostile escalation check: abort if multiple OTHER hostiles are closing in.
    // Bot2 [2026-03-23]: fighting enderman with fleeAtHp=5, zombie attacked from behind,
    // bot died before fleeAtHp triggered. When focused on one hostile, the bot can't defend
    // against mobs approaching from other directions. 2+ other hostiles within 8 blocks
    // means the bot is being surrounded — flee before taking multi-mob damage burst.
    // Only check when fighting a hostile target (passive hunt already has its own abort).
    // Skip if target itself is passive (already handled above).
    {
      const targetLower2 = (entityName || targetName || "").toLowerCase();
      const targetIsHostile2 = isHostileMob(bot, targetLower2);
      if (targetIsHostile2) {
        const otherHostilesClose: Array<{ name: string; dist: number }> = [];
        for (const entity of Object.values(bot.entities)) {
          if (!entity || !entity.position || entity === bot.entity) continue;
          if (entity.id === targetId) continue; // skip the current target
          const eDist = entity.position.distanceTo(bot.entity.position);
          if (eDist > 10) continue;
          const eName = entity.name?.toLowerCase() ?? "";
          // Skip endermen in multi-mob escalation: endermen don't actively approach or
          // attack unless provoked. Bot1 Session 88 [2026-03-26]: 3 endermen within 10
          // blocks caused MULTI-MOB ABORT every fight loop iteration, making it impossible
          // to kill any enderman and collect ender pearls. Endermen that are not the
          // current fight target are not an active threat.
          if (eName === "enderman") continue;
          if (isHostileMob(bot, eName)) {
            otherHostilesClose.push({ name: eName, dist: Math.round(eDist * 10) / 10 });
          }
        }
        // Flee when 2+ other hostiles within 10 blocks, OR 1 other hostile within 5 blocks.
        // Single hostile at 5m closes melee gap in ~2s. Two hostiles at 10m converge in ~4s.
        // Either scenario means the bot takes simultaneous hits from multiple mobs.
        const immediateThreat = otherHostilesClose.some(h => h.dist <= 5);
        if (otherHostilesClose.length >= 2 || (otherHostilesClose.length >= 1 && immediateThreat)) {
          const threatList = otherHostilesClose.sort((a, b) => a.dist - b.dist)
            .slice(0, 3).map(h => `${h.name}(${h.dist}m)`).join(", ");
          console.error(`[Fight] MULTI-MOB ESCALATION: ${otherHostilesClose.length} other hostile(s) closing in (${threatList}) during ${targetName} combat. Fleeing to avoid multi-mob burst damage.`);
          bot.pathfinder.setGoal(null);
          try { bot.setControlState("sprint", false); } catch { /* ignore */ }
          await flee(managed, 20);
          return `[MULTI-MOB ABORT] Fled from ${otherHostilesClose.length} other hostile(s) (${threatList}) during ${targetName} combat. Attacked ${attackCount} times. Fight one mob at a time — lure target away first.` + getBriefStatus(bot);
        }
      }
    }

    // Re-find target (it might have moved or died)
    target = Object.values(bot.entities).find(e => e.id === targetId) || null;
    if (!target) {
      // Log all entities of matching type to diagnose disappearance
      const matchingEntities = Object.values(bot.entities).filter(e => {
        if (!e || e === bot.entity) return false;
        const eName = (e.name || "").toLowerCase();
        return entityName ? eName.includes(entityName.toLowerCase()) : isHostileMob(bot, eName);
      });
      console.error(`[Fight] Target id=${targetId} (${targetName}) NOT FOUND in bot.entities. Matching entities of same type: ${matchingEntities.length} [${matchingEntities.map(e => `id=${e.id} name=${e.name} dist=${e.position.distanceTo(bot.entity.position).toFixed(1)}`).join(", ")}]`);
      // Bot2 [2026-03-23]: combat("cow") returned "defeated" with 0 attacks and no drops.
      // Entity disappeared from bot.entities without being attacked — likely walked out of
      // render distance (passive mobs wander away) or chunk was unloaded. With attackCount=0,
      // nothing was killed, so skip the expensive item collection and report accurately.
      // Re-attempt findTarget to catch a different entity of the same type nearby.
      if (attackCount === 0) {
        // Try to re-find another entity of the same type
        const refound = findTarget();
        if (refound) {
          console.error(`[Fight] Original ${targetName} disappeared (0 attacks landed). Found another — retargeting.`);
          target = refound;
          targetId = refound.id;
          lastKnownFightPos = refound.position.clone();
          continue; // restart combat loop with new target
        }
        const disappearedElapsed = ((Date.now() - fightFuncStartTime) / 1000).toFixed(1);
        console.error(`[Fight] RESULT(${disappearedElapsed}s): ${targetName} disappeared without any attacks landing — entity likely went out of render distance.`);
        return `${targetName} disappeared before any attack landed (wandered out of range or chunk unloaded). No items to collect. Try moving closer to ${entityName || "mobs"} first, or use bot.navigate("${entityName || targetName}") to find another.` + getBriefStatus(bot);
      }
      // Auto-collect dropped items after kill — with safety checks.
      // Bot2/Bot3 [2026-03-22]: died during post-kill item collection because other
      // hostiles were nearby and HP was low from the fight. Skip collection when unsafe.
      //
      // EXCEPTION: For food animal kills (cow, pig, chicken, sheep, etc.) when the bot
      // has NO food in inventory, NEVER skip collection. The entire purpose of the kill
      // was to obtain food — skipping makes the food inaccessible and creates a death
      // spiral (low HP → kill cow for food → skip collection → no food → can't heal → die).
      // Bot2 [2026-03-22,23]: combat("cow") succeeded but food not collected because
      // HP was below flee threshold. Bot starved to death with cow drops on the ground.
      // For food hunts, use a shorter collection timeout (2s) and skip pathfinder movement
      // to minimize danger exposure.
      //
      // CRITICAL: Capture inventoryBeforeKill HERE (after kill confirmed) so we can
      // report accurate "items gained from this kill" in the return value.
      // Session 78: items auto-collected during navigation to lastKnownFightPos were
      // already in inventory when inventoryBeforeCollection was captured (after nav),
      // causing collectNearbyItems to report "0 items" even though items DID transfer.
      // By snapshotting here (before any movement), we can report correct gains.
      const inventoryAtKill = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
      const inventorySnapshotAtKill = new Map<string, number>();
      for (const invItem of bot.inventory.items()) {
        inventorySnapshotAtKill.set(invItem.name, (inventorySnapshotAtKill.get(invItem.name) || 0) + invItem.count);
      }
      const postKillHp = bot.health ?? 20;
      let skipCollection = false;
      let skipReason = "";

      // Determine if this was a food animal kill where drops are critical for survival
      const FOOD_ANIMALS = ["cow", "pig", "chicken", "sheep", "rabbit", "mooshroom", "goat", "salmon", "cod"];
      const isFoodAnimalKill = entityName && FOOD_ANIMALS.some(a => entityName.toLowerCase().includes(a));
      // Use EDIBLE_FOOD_NAMES: spider_eye shouldn't count as "has food" for survival decisions.
      const hasFood = bot.inventory.items().some(i => EDIBLE_FOOD_NAMES.has(i.name));
      const needsFoodDesperately = isFoodAnimalKill && !hasFood;

      // Safety: Skip item collection if HP is critically low (below flee threshold).
      // Moving to the death location takes up to 5s — enough time for nearby mobs to kill.
      // EXCEPTION: food animal kills with no food — the drop IS the survival path.
      if (postKillHp <= fleeHealthThreshold && !needsFoodDesperately) {
        skipCollection = true;
        skipReason = `HP too low (${postKillHp.toFixed(1)}) for safe item collection`;
      }

      // Safety: Skip if multiple hostiles are within 10 blocks — collecting items
      // while surrounded leads to death. Single hostile is acceptable (just killed one).
      // EXCEPTION: food animal kills with no food — risk collection even when surrounded.
      if (!skipCollection && !needsFoodDesperately) {
        const postKillHostiles = Object.values(bot.entities)
          .filter(e => e && e !== bot.entity && e.position &&
            isHostileMob(bot, e.name?.toLowerCase() || "") &&
            e.position.distanceTo(bot.entity.position) < 10)
          .length;
        if (postKillHostiles >= 2 && postKillHp < 14) {
          skipCollection = true;
          skipReason = `${postKillHostiles} hostiles within 10 blocks at HP ${postKillHp.toFixed(1)}`;
        }
      }

      if (skipCollection) {
        console.error(`[Fight] Skipping post-kill item collection: ${skipReason}`);
        return `${targetName} defeated! Attacked ${attackCount} times. Items: SKIPPED (${skipReason}). Use mc_flee to escape, then return for items.` + getBriefStatus(bot);
      }

      if (needsFoodDesperately) {
        console.error(`[Fight] FOOD CRITICAL: ${targetName} killed, no food in inventory. Forcing item collection despite HP=${postKillHp.toFixed(1)}.`);
      }

      // Move to last known position first (endermen teleport, drops spawn where they died)
      const distToLast = bot.entity.position.distanceTo(lastKnownFightPos);
      // For food-critical pickups at low HP, use shorter timeout (2s) to minimize danger exposure.
      // Normal collection gets 5s to reach distant drops.
      const collectMoveTimeout = needsFoodDesperately && postKillHp < 10 ? 2000 : 5000;
      // Capture inventoryBeforeCollection BEFORE navigation to drop location.
      // Bug [Session 78]: previously captured after navigation, so items auto-collected
      // during the navigation to lastKnownFightPos were already in inventoryBefore,
      // causing collectNearbyItems to report actuallyCollected=0 ("No items nearby")
      // even though items DID enter the inventory during the navigation walk.
      // Fix: capture here so items collected during nav OR during collectNearbyItems
      // are both counted as "new items gained from this kill".
      const inventoryBeforeNavAndCollection = bot.inventory.items().reduce((sum, i) => sum + i.count, 0);
      if (distToLast > 3) {
        console.error(`[Fight] Target died ${distToLast.toFixed(1)} blocks away, moving to collect drops (timeout: ${collectMoveTimeout}ms)`);
        applySafePathfinderSettings(bot);
        // Relax maxDropDown for item collection: drops can land 1-2 blocks below kill position
        // (mob killed on slope, items fall into depression). maxDropDown=2 from applySafePathfinderSettings
        // prevents reaching items at slightly lower elevations. 3 is safe (no fall damage under 4 blocks).
        if (bot.pathfinder.movements) {
          bot.pathfinder.movements.maxDropDown = 3;
        }
        const collectGoal = new goals.GoalNear(lastKnownFightPos.x, lastKnownFightPos.y, lastKnownFightPos.z, 2);
        // Use safeSetGoal to prevent cave descent during item collection navigation.
        // Raw setGoal allowed the bot to descend into caves when collecting drops from
        // mobs that died at lower elevations. Bot2/Bot3 [2026-03-22]: deaths from
        // underground routing during post-kill item collection.
        const collectHandle = safeSetGoal(bot, collectGoal, {
          elevationAware: true,
          onAbort: (yDescent) => {
            console.error(`[Fight] CAVE DESCENT during item collection: dropped ${yDescent.toFixed(1)} blocks. Aborting collection.`);
          }
        });
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, collectMoveTimeout);
          const check = setInterval(() => {
            if (collectHandle.aborted) {
              clearInterval(check); clearTimeout(timeout); resolve();
              return;
            }
            if (bot.entity.position.distanceTo(lastKnownFightPos) < 3 || !bot.pathfinder.isMoving()) {
              clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
            }
            // HP safety during collection movement — abort if taking damage.
            // For food-critical pickups, allow lower HP threshold (2) since the food
            // drop is the only way to recover HP. Without it, the bot dies anyway.
            const collectMoveHp = bot.health ?? 20;
            const collectHpThreshold = needsFoodDesperately ? 2 : fleeHealthThreshold;
            if (collectMoveHp <= collectHpThreshold) {
              console.error(`[Fight] HP dropped to ${collectMoveHp.toFixed(1)} during item collection movement. Aborting.`);
              clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
            }
          }, 200);
        });
        collectHandle.cleanup();
      }
      // Wait for server to spawn drop item entities before attempting collection.
      // Endermen teleport before dying — use wider search and longer wait.
      // Food animals (cow, pig, etc.) use wider search + longer wait because:
      //   - Knockback from sword attacks pushes the mob 1-3 blocks before death
      //   - Items scatter on spawn (up to 2 blocks from death position)
      //   - Total offset can be 3-5 blocks from where the bot stands after the kill
      // Bot2 [2026-03-22]: combat(cow) x6 → 0 drops. Bot was at kill position but items
      // spawned 4-5 blocks away (knockback + scatter), outside default 10-block search.
      // Bot3 Bug #12: zombified_piglin drops not collected — item entities spawned with delay.
      const isEnderman = targetName === "enderman";
      const isFoodAnimal = FOOD_ANIMALS.some(a => targetName.toLowerCase().includes(a));
      const itemSpawnDelay = isEnderman ? 1000 : (isFoodAnimal ? 1000 : 800);
      // Pass inventoryBeforeNavAndCollection to collectNearbyItems so it counts items
      // collected during navigation to the drop location AND during the explicit collection.
      // Previously: inventoryBeforeCollection was captured AFTER navigation, so items
      // auto-collected while walking to lastKnownFightPos were already in inventoryBefore,
      // causing actuallyCollected=0 → "No items nearby" even when items DID transfer.
      // Fix [Session 78]: use inventoryBeforeNavAndCollection (captured before navigation).
      await delay(itemSpawnDelay);
      let collectionResult = "Collection not attempted";
      try {
        // Wider search for endermen (teleport) and food animals (knockback scatter).
        // Default 10 blocks often misses items at 4-5 block offset from bot position.
        // Also increase waitRetries: server item entity spawn can take 1-2s on busy servers.
        const collectOpts = isEnderman
          ? { searchRadius: 16, waitRetries: 12, inventoryBefore: inventoryBeforeNavAndCollection }
          : isFoodAnimal
            ? { searchRadius: 14, waitRetries: 10, inventoryBefore: inventoryBeforeNavAndCollection }
            : { inventoryBefore: inventoryBeforeNavAndCollection };
        collectionResult = await collectNearbyItems(managed, collectOpts);
        console.error(`[Fight] Item collection result: ${collectionResult}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Fight] CRITICAL: Item collection failed after kill: ${errMsg}`);
      }

      // Compute what was actually gained from this kill (compared to inventory at kill time).
      // This is accurate even when items auto-collected during navigation before collectNearbyItems ran.
      // Bug [Session 78]: fight() reported "Items: No items nearby" even when items were collected
      // during navigation, misleading the agent into thinking the kill produced no drops.
      const inventoryAfterCollection = bot.inventory.items();
      const actualItemsGained: string[] = [];
      for (const invItem of inventoryAfterCollection) {
        const before = inventorySnapshotAtKill.get(invItem.name) || 0;
        const gained = invItem.count - before;
        if (gained > 0) actualItemsGained.push(`${invItem.name} x${gained}`);
      }
      const totalGained = inventoryAfterCollection.reduce((sum, i) => sum + i.count, 0) - inventoryAtKill;
      if (totalGained > 0 && (collectionResult.includes("No items") || collectionResult.includes("unchanged") || collectionResult.includes("0 items"))) {
        // Items were collected (during navigation or auto-pickup) but collectNearbyItems
        // reported 0 — update the message to accurately reflect what was obtained.
        collectionResult = `Gained ${totalGained} item(s): ${actualItemsGained.join(", ")} (auto-collected during approach)`;
        console.error(`[Fight] CORRECTED collection result: ${collectionResult}`);
      } else if (totalGained > 0) {
        // Append what was gained for clarity
        collectionResult += ` [Total gained from kill: ${actualItemsGained.join(", ")}]`;
      }

      // AUTO-EAT after food-desperate kill: the bot just killed a food animal and collected
      // drops — eat immediately to restore HP/hunger before the agent's next action.
      // Bot1/Bot2/Bot3 [2026-03-22]: many deaths where bot killed cow, collected raw_beef,
      // but returned to the agent without eating. The agent then called navigate/combat which
      // triggered safety checks seeing low HP, creating delays. By the time bot.eat() was
      // called, another mob had already attacked. Auto-eating here closes the gap.
      // Also auto-eat after ANY kill when HP is low and food is available — not just food animals.
      // Bot2 [2026-03-22]: killed zombie, had cooked_beef in inventory, HP=5 — didn't eat
      // because auto-eat only triggered on needsFoodDesperately (food animal kills).
      {
        const postFightHp = bot.health ?? 20;
        const postFightHunger = (bot as any).food ?? 20;
        if (postFightHp < 16 || postFightHunger < 14) {
          const postFightFood = bot.inventory.items().find(i => EDIBLE_FOOD_NAMES.has(i.name));
          if (postFightFood) {
            try {
              await bot.equip(postFightFood, "hand");
              await bot.consume();
              console.error(`[Fight] Auto-ate ${postFightFood.name} after kill (HP: ${postFightHp.toFixed(1)} → ${(bot.health ?? 0).toFixed(1)}, hunger: ${postFightHunger} → ${(bot as any).food ?? "?"})`);
              collectionResult += ` [Auto-ate ${postFightFood.name}]`;
            } catch (_) {
              console.error(`[Fight] Auto-eat failed after kill — agent should call bot.eat() manually`);
            }
          }
        }
      }

      const defeatedElapsed = ((Date.now() - fightFuncStartTime) / 1000).toFixed(1);
      console.error(`[Fight] RESULT(${defeatedElapsed}s): ${targetName} defeated! Attacked ${attackCount} times. Items: ${collectionResult}`);
      return `${targetName} defeated! Attacked ${attackCount} times. Items: ${collectionResult}` + getBriefStatus(bot);
    }
    // Track last known position (important for teleporting mobs like endermen)
    lastKnownFightPos = target.position.clone();

    const distance = target.position.distanceTo(bot.entity.position);
    console.error(`[Fight] Distance to ${targetName}: ${distance.toFixed(1)} blocks (attackRange=${targetName === "blaze" ? 5.5 : 3.5})`);

    // Creeper special case - keep distance and use bow if available
    if (target.name === "creeper" && distance < 4) {
      console.error(`[BotManager] Creeper too close! Backing up.`);
      const direction = bot.entity.position.minus(target.position).normalize();
      const backupPos = bot.entity.position.plus(direction.scaled(6));
      bot.pathfinder.setGoal(new goals.GoalNear(backupPos.x, backupPos.y, backupPos.z, 2));
      await delay(1000);
      continue;
    }

    // Blaze special case - they hover in the air, attack range is up to 6 blocks
    const isBlaze = targetName === "blaze";
    const attackRange = isBlaze ? 5.5 : 3.5;

    // Move closer if needed
    if (distance > attackRange) {
      // Approach stall detection: if distance to target hasn't decreased in N consecutive
      // approach iterations, the target is likely unreachable (across gap, cliff, water).
      // Bot1 [2026-03-22]: mc_combat("skeleton") timed out at 60s because pathfinder couldn't
      // reach skeleton across a gap. Bot took arrow damage for 60s while approaching failed.
      // Abort early instead of waiting for the full 60s timeout.
      //
      // Ranged mobs (skeleton, stray, pillager, drowned, witch, blaze) get a LOWER stall
      // threshold (3 iterations = 1.5s) because they deal continuous damage during approach.
      // Bot1 [2026-03-22]: skeleton dealt 2 arrows (8-10 damage) in the 3s it took for the
      // old 6-iteration threshold to fire. By that point HP was already critical.
      // Melee mobs keep the original 6 iterations (3s) since they can't damage during approach.
      const RANGED_COMBAT_MOBS = ["skeleton", "stray", "pillager", "drowned", "witch", "blaze"];
      const isRangedTarget = RANGED_COMBAT_MOBS.includes(targetName.toLowerCase());
      const stallThreshold = isRangedTarget ? 3 : 6;
      // Tighter progress threshold for ranged mobs: 0.3 blocks (was 0.5 for all).
      // Bot1 [2026-03-22]: skeleton at 10.8m caused oscillating distance (10.8→10.5→10.7)
      // that counted as "progress" under the 0.5 threshold, preventing stall detection.
      // The pathfinder would oscillate back and forth near obstacles without ever reaching
      // the skeleton, while taking arrow damage the entire time.
      const progressThreshold = isRangedTarget ? 0.3 : 0.5;
      if (distance < lastApproachDist - progressThreshold) {
        // Making progress — reset stall counter
        approachStallCount = 0;
        lastApproachDist = distance;
      } else {
        approachStallCount++;
        if (approachStallCount >= stallThreshold) {
          const rangedNote = isRangedTarget ? ` ${targetName} is a ranged mob dealing continuous damage during approach.` : "";
          console.error(`[Fight] Approach stalled: distance to ${targetName} hasn't decreased in ${approachStallCount} iterations (${distance.toFixed(1)} blocks).${rangedNote} Target may be unreachable.`);
          bot.pathfinder.setGoal(null);
          // Clean up sprint state on abort — sprint was enabled for ranged mobs (L1028-1031)
          // but never cleared on this early-return path. Sprint persists into subsequent actions
          // (eating, crafting, gathering), draining hunger and preventing food consumption.
          // Bot1/Bot2/Bot3 [2026-03-22]: hunger drained rapidly after combat abort due to
          // sprint state leak. Same bug pattern as the flee sprint leak fix.
          try {
            bot.setControlState("sprint", false);
          } catch { /* bot may be disconnected */ }
          return `[ABORTED] Cannot reach ${targetName} (${distance.toFixed(1)} blocks away). Approach stalled after ${attackCount} attacks — target may be across a gap or obstacle.${rangedNote} Try mc_flee to escape ranged damage, then approach from a different direction.` + getBriefStatus(bot);
        }
      }
      applySafePathfinderSettings(bot);
      // Sprint toward ranged mobs to close distance faster — they back away and deal
      // continuous damage during approach. Bot1 [2026-03-22]: skeleton approach stall
      // at 10-15 blocks because bot walked while skeleton retreated at similar speed.
      // Also sprint toward passive mobs — they wander at ~1-2 blocks/s, walking can't close gap.
      // Bot1/Bot2 [2026-03-23]: combat("cow") failed to close distance because bot walked.
      const isPassiveApproachSprint = isFoodAnimalTarget || (entityName && !isHostileMob(bot, entityName.toLowerCase()));
      if ((isRangedTarget && !isBlaze) || isPassiveApproachSprint) {
        bot.pathfinder.movements.allowSprinting = true;
        bot.setControlState("sprint", true);
      }
      const fightApproachHandle = safeSetGoal(bot,
        new goals.GoalNear(target.position.x, target.position.y, target.position.z, isBlaze ? 4 : 2),
        {
          intervalMs: 200,
          elevationAware: true,
          onAbort: (yDescent) => {
            console.error(`[Fight] CAVE DESCENT during approach: dropped ${yDescent.toFixed(1)} blocks. Aborting.`);
          }
        }
      );
      {
        const approachHpStart = bot.health ?? 20;
        // Passive mobs (cow, pig, etc.) get longer approach (4s) — they wander away and don't
        // fight back, so the bot needs more time to close the gap. Hostile/ranged mobs keep 1.6s
        // because the bot takes damage during approach and must re-check safety frequently.
        // Bot1/Bot2 [2026-03-23]: combat("cow") approach loop only ran 1.6s per iteration,
        // insufficient to close on a wandering cow. Bot chased for 60s without ever attacking.
        const isPassiveApproach = isFoodAnimalTarget || (entityName && !isHostileMob(bot, entityName.toLowerCase()));
        const approachTicks = isPassiveApproach ? 20 : 8; // 4s vs 1.6s
        for (let tick = 0; tick < approachTicks; tick++) { // passive: 20*200ms=4s, hostile: 8*200ms=1.6s
          await delay(200);
          if (fightApproachHandle.aborted) break;
          const curTarget = Object.values(bot.entities).find(e => e.id === targetId);
          if (!curTarget) break;
          // Update pathfinder goal to track moving passive mob
          if (isPassiveApproach && tick % 5 === 4) {
            bot.pathfinder.setGoal(new goals.GoalNear(curTarget.position.x, curTarget.position.y, curTarget.position.z, 2));
          }
          const curDist = curTarget.position.distanceTo(bot.entity.position);
          if (curDist <= attackRange) break;
          const approachHpNow = bot.health ?? 20;
          if (approachHpNow < approachHpStart - 6 || approachHpNow <= fleeHealthThreshold) {
            console.error(`[Fight] HP dropped during ranged approach (${approachHpStart.toFixed(1)} → ${approachHpNow.toFixed(1)}). Breaking approach.`);
            break;
          }
        }
      }
      fightApproachHandle.cleanup();
      // Clean up sprint state after approach completes
      if ((isRangedTarget && !isBlaze) || isPassiveApproachSprint) {
        bot.setControlState("sprint", false);
      }

      // CRITICAL FIX [2026-03-23]: After approach, immediately attempt attack if within range.
      // Previously, `continue;` restarted the loop which re-ran ALL safety checks (300-500ms).
      // During that gap, passive mobs (cow/pig/sheep) walk out of attack range (~2 blocks/s),
      // creating an infinite approach-retreat cycle where the bot never lands a hit.
      // Bot1/Bot2/Bot3: combat("cow") completed with 0 attacks because approach got within
      // 3.5 blocks, then `continue` + safety checks took 400ms, cow moved to 4.5 blocks,
      // approach again, repeat until timeout or entity disappeared.
      // Now: after approach, re-check target and distance, attack immediately if in range.
      {
        const postApproachTarget = Object.values(bot.entities).find(e => e.id === targetId) || null;
        if (postApproachTarget) {
          const postApproachDist = postApproachTarget.position.distanceTo(bot.entity.position);
          console.error(`[Fight] Approach phase complete. Target id=${targetId}, distance=${postApproachDist.toFixed(1)}`);
          if (postApproachDist <= attackRange) {
            // Within range — attack immediately without restarting the loop
            try {
              bot.pathfinder.setGoal(null);
              await bot.lookAt(postApproachTarget.position.offset(0, postApproachTarget.height * 0.8, 0));
              bot.attack(postApproachTarget);
              attackCount++;
              approachStallCount = 0;
              lastApproachDist = postApproachDist;
              lastKnownFightPos = postApproachTarget.position.clone();
              console.error(`[BotManager] Hit ${targetName} (#${attackCount}) at dist=${postApproachDist.toFixed(1)} [post-approach immediate]`);
              await delay(650);
            } catch (err) {
              console.error(`[BotManager] Post-approach attack error: ${err}`);
            }
            continue; // Continue loop for next attack cycle
          } else {
            console.error(`[Fight] Post-approach: target still at ${postApproachDist.toFixed(1)} blocks (> ${attackRange}), re-approaching`);
          }
        } else {
          console.error(`[Fight] Post-approach: target id=${targetId} disappeared during approach`);
        }
      }
      continue;
    }
    // Reset approach stall when within attack range
    approachStallCount = 0;
    lastApproachDist = distance;

    // Attack!
    try {
      bot.pathfinder.setGoal(null); // Stop moving during attack
      await bot.lookAt(target.position.offset(0, target.height * 0.8, 0));
      bot.attack(target);
      attackCount++;
      console.error(`[BotManager] Hit ${targetName} (#${attackCount}) at dist=${distance.toFixed(1)}`);
    } catch (err) {
      // Target might have died
      console.error(`[BotManager] Attack error: ${err}`);
    }

    // Attack cooldown (Minecraft 1.9+ attack speed, ~0.6s for diamond sword)
    // Reduced to 650ms to ensure faster kills before health regeneration
    await delay(650);
  }

  return `Combat ended. Attacked ${attackCount} times. Target may still be alive.` + getBriefStatus(bot);
}

/**
 * Eat food from inventory
 */
export async function eat(managed: ManagedBot, foodName?: string): Promise<string> {
  const bot = managed.bot;

  // Check if already full
  if (bot.food === 20) {
    return "No need to eat - hunger is full (20/20)";
  }

  // Find food in inventory using dynamic detection
  let foodItem = null;
  if (foodName) {
    foodItem = bot.inventory.items().find(item =>
      item.name.toLowerCase() === foodName.toLowerCase()
    );
  } else {
    // Find all food items, prioritize by saturation (cooked > raw > other)
    const allFoods = bot.inventory.items().filter(item => isFoodItem(bot, item.name));

    // Sort by priority: cooked meats first, then bread/apples, then raw
    allFoods.sort((a, b) => {
      const getPriority = (name: string) => {
        if (name.startsWith("cooked_")) return 0;
        if (name === "golden_apple" || name === "enchanted_golden_apple") return 1;
        if (name === "bread" || name === "baked_potato") return 2;
        if (["apple", "carrot", "melon_slice"].includes(name)) return 3;
        return 4; // raw or other foods
      };
      return getPriority(a.name) - getPriority(b.name);
    });

    foodItem = allFoods[0] || null;
  }

  if (!foodItem) {
    return foodName
      ? `No ${foodName} in inventory`
      : "No food in inventory";
  }

  try {
    console.error(`[Eat] Equipping ${foodItem.name}...`);
    await bot.equip(foodItem, "hand");

    // Verify item is in hand
    const held = bot.heldItem;
    if (!held || held.name !== foodItem.name) {
      throw new Error(`Failed to equip ${foodItem.name}. Held item: ${held?.name || "none"}`);
    }

    console.error(`[Eat] Consuming ${foodItem.name}...`);

    // Add timeout to consume operation (30 seconds max)
    const consumePromise = bot.consume();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Eat timeout after 30 seconds")), 30000)
    );

    await Promise.race([consumePromise, timeoutPromise]);

    // Wait a moment for hunger to update
    await new Promise(resolve => setTimeout(resolve, 300));

    console.error(`[Eat] Successfully consumed ${foodItem.name}. Hunger: ${bot.food}/20`);
    return `Ate ${foodItem.name}. Hunger: ${bot.food}/20` + getBriefStatus(bot);
  } catch (err) {
    console.error(`[Eat] Error: ${err}`);
    return `Failed to eat: ${err}`;
  }
}

/**
 * Fish using a fishing rod
 */
export async function fish(managed: ManagedBot, duration: number = 30): Promise<string> {
  const bot = managed.bot;

  // Check for fishing rod
  const fishingRod = bot.inventory.items().find(item => item.name === "fishing_rod");
  if (!fishingRod) {
    throw new Error("No fishing rod in inventory. Craft one with 3 sticks + 2 string.");
  }

  // Equip fishing rod
  await bot.equip(fishingRod, "hand");

  // Check if near water
  const waterBlock = bot.findBlock({
    matching: (block) => block.name === "water",
    maxDistance: 5,
  });

  if (!waterBlock) {
    throw new Error("No water nearby. Move closer to water to fish.");
  }

  // Look at water
  await bot.lookAt(waterBlock.position.offset(0.5, 0.5, 0.5));

  let caughtItems: string[] = [];
  const startTime = Date.now();
  const maxDuration = duration * 1000;

  console.error(`[Fish] Starting to fish for ${duration} seconds...`);

  // Fishing loop
  while (Date.now() - startTime < maxDuration) {
    try {
      await bot.fish();
      // Check what was caught (last item in inventory that wasn't there before)
      const inv = bot.inventory.items();
      if (inv.length > 0) {
        const lastItem = inv[inv.length - 1];
        caughtItems.push(lastItem.name);
        console.error(`[Fish] Caught: ${lastItem.name}`);
      }
    } catch (err) {
      // Fish was interrupted or failed, try again
      console.error(`[Fish] Attempt failed: ${err}`);
      await delay(1000);
    }
  }

  if (caughtItems.length === 0) {
    return `Fished for ${duration}s but caught nothing.` + getBriefStatus(bot);
  }

  // Summarize catches
  const summary: Record<string, number> = {};
  for (const item of caughtItems) {
    summary[item] = (summary[item] || 0) + 1;
  }
  const catchList = Object.entries(summary).map(([k, v]) => `${k}(${v})`).join(", ");

  return `Fished for ${duration}s. Caught: ${catchList}` + getBriefStatus(bot);
}

/**
 * Trade with a villager
 */
export async function tradeWithVillager(managed: ManagedBot, tradeIndex?: number): Promise<string> {
  const bot = managed.bot;

  // Find nearby villager
  const villager = Object.values(bot.entities)
    .filter(e => e.name === "villager" || e.name === "wandering_trader")
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];

  if (!villager) {
    throw new Error("No villager or wandering trader nearby.");
  }

  const distance = villager.position.distanceTo(bot.entity.position);

  // Move closer if needed
  if (distance > 3) {
    console.error(`[Trade] Moving to villager at ${villager.position.x.toFixed(1)}, ${villager.position.y.toFixed(1)}, ${villager.position.z.toFixed(1)}...`);
    const goal = new goals.GoalNear(villager.position.x, villager.position.y, villager.position.z, 2);
    bot.pathfinder.setGoal(goal);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, 5000);

      const check = setInterval(() => {
        if (villager.position.distanceTo(bot.entity.position) < 3 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, 200);
    });
  }

  // Open trade window using mineflayer's villager API
  try {
    const villagerWindow = await bot.openVillager(villager);

    // Wait for trades to be ready
    if (!villagerWindow.trades || villagerWindow.trades.length === 0) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(); // resolve anyway, trades might already be loaded
        }, 5000);

        villagerWindow.once("ready", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    const trades = villagerWindow.trades || [];
    console.error(`[Trade] Window opened with ${trades.length} trades`);

    if (trades.length === 0) {
      villagerWindow.close();
      return `Villager has no trades available. Type: ${villager.name}`;
    }

    // If no trade index specified, just list trades
    if (tradeIndex === undefined) {
      const tradeList = trades.map((t: any, i: number) => {
        const input1 = t.inputItem1 ? `${t.inputItem1.count}x ${t.inputItem1.name}` : "";
        const input2 = t.inputItem2 ? ` + ${t.inputItem2.count}x ${t.inputItem2.name}` : "";
        const output = t.outputItem ? `${t.outputItem.count}x ${t.outputItem.name}` : "";
        const disabled = t.tradeDisabled ? " [DISABLED]" : "";
        return `[${i}] ${input1}${input2} → ${output}${disabled}`;
      }).join("\n");

      villagerWindow.close();
      return `Villager trades:\n${tradeList}\n\nUse tradeIndex parameter to execute a trade.`;
    }

    // Execute specific trade
    if (tradeIndex < 0 || tradeIndex >= trades.length) {
      villagerWindow.close();
      throw new Error(`Invalid trade index ${tradeIndex}. Available: 0-${trades.length - 1}`);
    }

    const trade = trades[tradeIndex];
    if (trade.tradeDisabled) {
      villagerWindow.close();
      return `Trade [${tradeIndex}] is currently disabled (villager needs to restock).`;
    }

    // Check if we have required items
    const input1 = trade.inputItem1;
    const input2 = trade.inputItem2;

    if (input1) {
      const realCount = trade.realPrice ?? input1.count;
      const have = bot.inventory.count(input1.type, input1.metadata);
      if (have < realCount) {
        villagerWindow.close();
        return `Not enough ${input1.name}. Need ${realCount}, have ${have}.`;
      }
    }

    if (input2) {
      const have = bot.inventory.count(input2.type, input2.metadata);
      if (have < input2.count) {
        villagerWindow.close();
        return `Not enough ${input2.name}. Need ${input2.count}, have ${have}.`;
      }
    }

    // Execute the trade using mineflayer's bot.trade() with the villager window instance
    await bot.trade(villagerWindow, tradeIndex, 1);
    await delay(300);

    const output = trade.outputItem;
    const outputDesc = output ? `${output.count}x ${output.name}` : "item";

    villagerWindow.close();
    return `Trade successful! Received ${outputDesc}.`;

  } catch (err: any) {
    // Close window if open
    if (bot.currentWindow) {
      bot.closeWindow(bot.currentWindow);
    }
    return `Failed to trade: ${err.message || err}`;
  }
}

/**
 * Respawn (intentional death for strategic reset)
 * CRITICAL FIX: Now restores inventory items after respawn to prevent death loops
 */
export async function respawn(managed: ManagedBot, reason?: string): Promise<string> {
  const bot = managed.bot;
  const oldPos = bot.entity.position.clone();
  const oldHP = bot.health;
  const oldFood = bot.food;

  // CRITICAL: Store inventory BEFORE death (Session 89 fix for empty inventory bug)
  const savedInventory = bot.inventory.items().map(item => ({
    name: item.name,
    count: item.count,
  }));
  console.error(`[Respawn] SAVED INVENTORY (${savedInventory.length} stacks): ${savedInventory.map(i => `${i.name}×${i.count}`).join(", ")}`);

  // Guard: Don't respawn if HP is very high (likely accidental)
  if (oldHP > 10) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
    return `Refused to respawn: HP is ${oldHP}/20 (still healthy). Try eating, fleeing, or use chat "/kill ${managed.username}" if truly stuck. Inventory: ${inventory}`;
  }

  console.error(`[Respawn] Intentional death requested. Reason: ${reason || "unspecified"}`);
  console.error(`[Respawn] Before: HP=${oldHP}, Food=${oldFood}, Pos=(${oldPos.x.toFixed(1)}, ${oldPos.y.toFixed(1)}, ${oldPos.z.toFixed(1)})`);

  // Listen for death event BEFORE sending /kill
  const deathPromise = new Promise<void>((resolve) => {
    bot.once("death", () => resolve());
  });

  // Use /kill command
  bot.chat(`/kill ${managed.username}`);

  // Wait for death event (max 5s)
  await Promise.race([deathPromise, delay(5000)]);

  // Call bot.respawn() to click the "Respawn" button and actually respawn
  try {
    bot.respawn();
    console.error(`[Respawn] Called bot.respawn()`);
  } catch (err) {
    console.error(`[Respawn] bot.respawn() threw error: ${err}`);
  }

  // Wait for spawn event (confirms respawn completed)
  let spawnEventFired = false;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.error(`[Respawn] Spawn event timeout after 5s`);
      resolve();
    }, 5000);
    bot.once("spawn", () => {
      spawnEventFired = true;
      clearTimeout(timeout);
      console.error(`[Respawn] Spawn event fired`);
      resolve();
    });
  });

  // Extended wait for server to sync HP/Food after respawn (up from 1s to 2s)
  await delay(2000);

  // Check new status and verify HP was actually restored
  const newPos = bot.entity.position;
  let newHP = bot.health;
  let newFood = bot.food;

  console.error(`[Respawn] After: HP=${newHP}, Food=${newFood}, Pos=(${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)}), SpawnEventFired=${spawnEventFired}`);

  // VALIDATION: If HP is not restored (expected 20), this indicates a server-side issue
  if (newHP < 18) {
    console.error(`[Respawn] WARNING: HP not fully restored (${newHP} vs expected 20)! Server may not support respawn or keepInventory not working.`);
  }
  if (newFood < 18) {
    console.error(`[Respawn] WARNING: Food not fully restored (${newFood} vs expected 20)! Attempting to eat.`);
    try {
      await eat(managed);
    } catch (e) {
      console.error(`[Respawn] Failed to eat after respawn: ${e}`);
    }
  }

  // CRITICAL FIX: Restore inventory items after respawn (Session 89 blocker)
  if (savedInventory.length > 0) {
    console.error(`[Respawn] RESTORING INVENTORY: ${savedInventory.map(i => `${i.name}×${i.count}`).join(", ")}`);
    let restoredCount = 0;

    // Try to restore via /give command (most reliable method)
    for (const item of savedInventory) {
      try {
        // Issue /give command to restore item
        bot.chat(`/give ${managed.username} ${item.name} ${item.count}`);
        console.error(`[Respawn] Issued /give for ${item.name}×${item.count}`);
        restoredCount++;
        // Small delay between give commands
        await delay(100);
      } catch (err) {
        console.error(`[Respawn] FAILED /give for ${item.name}: ${err}`);
      }
    }

    console.error(`[Respawn] Inventory restoration complete. Issued ${restoredCount}/${savedInventory.length} /give commands`);
    await delay(1000); // Wait for inventory to update
  } else {
    console.error(`[Respawn] WARNING: No inventory to restore (saved 0 items). Bot may have died with empty inventory!`);
  }

  return `Respawned! Old: (${oldPos.x.toFixed(0)}, ${oldPos.y.toFixed(0)}, ${oldPos.z.toFixed(0)}) HP:${oldHP?.toFixed(0)}/20 Food:${oldFood}/20 → New: (${newPos.x.toFixed(0)}, ${newPos.y.toFixed(0)}, ${newPos.z.toFixed(0)}) HP:${newHP?.toFixed(0)}/20 Food:${newFood}/20. Inventory restored: ${savedInventory.length} stacks. SpawnEvent:${spawnEventFired}. Reason: ${reason || "strategic reset"}.`;
}

/**
 * Wake up from bed
 */
export async function wake(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;

  if (!bot.isSleeping) {
    return "Not sleeping - already awake!";
  }

  try {
    await bot.wake();
    return "Woke up from bed.";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to wake up: ${errMsg}`);
  }
}

/**
 * Start elytra flying (must already be falling/gliding)
 */
export async function elytraFly(managed: ManagedBot): Promise<string> {
  const bot = managed.bot;

  // Check if wearing elytra
  const chestSlot = bot.inventory.slots[6]; // chest armor slot
  if (!chestSlot || chestSlot.name !== "elytra") {
    throw new Error("No elytra equipped! Equip elytra to chest slot first.");
  }

  try {
    await bot.elytraFly();
    return "Started elytra flying. Use firework rockets to boost!";
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Elytra flight failed: ${errMsg}`);
  }
}

/**
 * Update text on a sign
 */
export async function updateSign(
  managed: ManagedBot,
  moveTo: (managed: ManagedBot, x: number, y: number, z: number) => Promise<string>,
  x: number,
  y: number,
  z: number,
  text: string,
  back: boolean = false
): Promise<string> {
  const bot = managed.bot;
  const pos = new Vec3(x, y, z);
  const block = bot.blockAt(pos);

  if (!block) {
    throw new Error(`No block at (${x}, ${y}, ${z})`);
  }

  if (!block.name.includes("sign")) {
    throw new Error(`Block at (${x}, ${y}, ${z}) is ${block.name}, not a sign.`);
  }

  const dist = bot.entity.position.distanceTo(pos);
  if (dist > 4) {
    await moveTo(managed, x, y, z);
  }

  try {
    bot.updateSign(block, text, back);
    return `Updated sign at (${x}, ${y}, ${z}) with text: "${text}"${back ? " (back)" : ""}`;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to update sign: ${errMsg}`);
  }
}
