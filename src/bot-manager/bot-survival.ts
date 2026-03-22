import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
import type { ManagedBot } from "./types.js";
import { isHostileMob, isNeutralMob, isFoodItem, isBedBlock, isNearCliffEdge } from "./minecraft-utils.js";
import { collectNearbyItems, equipArmor } from "./bot-items.js";

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

  // Check if it's night time
  const time = bot.time.timeOfDay;
  if (time < 12541 || time > 23458) {
    return "Cannot sleep - it's not night time yet. Wait until dusk.";
  }

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

  // Auto-eat before combat if HP is not full and food is available
  if (bot.health < 16 && bot.food < 20) {
    const foodItem = bot.inventory.items().find(i => isFoodItem(bot, i.name));
    if (foodItem) {
      try {
        await bot.equip(foodItem, "hand");
        await bot.consume();
        console.error(`[Attack] Auto-ate ${foodItem.name} before combat (HP: ${bot.health}, hunger: ${bot.food})`);
      } catch (_) { /* ignore eat errors */ }
    }
  }

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
    target = entities
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
      )[0];
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
      bot.pathfinder.setGoal(approachGoal);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 8000);
        const check = setInterval(() => {
          const currentDist = target.position.distanceTo(bot.entity.position);
          if (currentDist <= 14 || !bot.pathfinder.isMoving()) {
            clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
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
    // Eat before approaching if not full HP (fireballs deal damage during approach)
    if (bot.health < 18 && bot.food < 20) {
      const food = bot.inventory.items().find(i => isFoodItem(bot, i.name));
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
    bot.pathfinder.setGoal(goal);

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

        if (currentDist < 3.5 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
          return;
        }

        // Ranged mobs: re-target every 500ms to track their retreat path
        if (isRangedMob && Date.now() - lastRetargetTime > 500) {
          lastRetargetTime = Date.now();
          try {
            const retargetGoal = new goals.GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, 2);
            bot.pathfinder.setGoal(retargetGoal);
          } catch { /* ignore */ }
        }
      }, 200);
    });

    // Clean up sprint state after approach
    if (isRangedMob) {
      bot.setControlState("sprint", false);
    }

    if (approachAbortReason) {
      const abortHp = (bot.health ?? 0).toFixed(1);
      return `[ABORTED] Attack approach stopped — ${approachAbortReason}. HP=${abortHp}/20. Use mc_eat to heal or mc_flee to escape.`;
    }

    distance = target.position.distanceTo(bot.entity.position);
  }

  // Attack repeatedly until entity is dead or too far
  const targetId = target.id;
  let attacks = 0;
  const maxAttacks = 20; // Safety limit (20 attacks should kill most mobs)
  let lastKnownTargetPos = target.position.clone();
  const attackStartTime = Date.now();
  const ATTACK_TIMEOUT_MS = 60000; // 60s max — prevents infinite pathfinder loops

  try {
    while (attacks < maxAttacks) {
      // Global timeout check
      if (Date.now() - attackStartTime > ATTACK_TIMEOUT_MS) {
        console.error(`[Attack] Global timeout (${ATTACK_TIMEOUT_MS / 1000}s) reached after ${attacks} attacks. Aborting.`);
        bot.pathfinder.setGoal(null);
        return `Attack timed out after ${attacks} attacks. Target may be unreachable.`;
      }
      // Check HP - flee if low (raised from 8 to 12 for better survival margin)
      // Bug fix: previously this just returned "Fled" without actually fleeing — bot stayed
      // in place next to the hostile mob. Now actually moves away using pathfinder.
      // Bot1 [2026-03-22]: "Fled from skeleton" but skeleton kept shooting because bot didn't move.
      if (bot.health <= 12) {
        console.error(`[Attack] HP low (${bot.health}), fleeing from ${target.name}!`);
        bot.pathfinder.setGoal(null);
        // Try to eat food before fleeing
        const food = bot.inventory.items().find(i => isFoodItem(bot, i.name));
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
        const midAttackFood = bot.inventory.items().find(i => isFoodItem(bot, i.name));
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
        // Move to last known position first (endermen teleport, drops spawn where they died)
        const distToLastPos = bot.entity.position.distanceTo(lastKnownTargetPos);
        if (distToLastPos > 3) {
          console.error(`[Attack] Target died ${distToLastPos.toFixed(1)} blocks away, moving to last known pos to collect drops`);
          applySafePathfinderSettings(bot);
          const collectGoal = new goals.GoalNear(lastKnownTargetPos.x, lastKnownTargetPos.y, lastKnownTargetPos.z, 2);
          bot.pathfinder.setGoal(collectGoal);
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 5000);
            const check = setInterval(() => {
              if (bot.entity.position.distanceTo(lastKnownTargetPos) < 3 || !bot.pathfinder.isMoving()) {
                clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
              }
            }, 200);
          });
        }
        // Endermen teleport before dying — use wider search and longer wait
        // 800ms gives the server time to spawn drop item entities (was 500ms, too short)
        const isEnderman = target.name === "enderman";
        await delay(isEnderman ? 1000 : 800);
        let collectionResult = "Collection not attempted";
        try {
          collectionResult = await collectNearbyItems(managed, isEnderman ? { searchRadius: 16, waitRetries: 12 } : undefined);
          console.error(`[Attack] Item collection result: ${collectionResult}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Attack] CRITICAL: Item collection failed after kill: ${errMsg}`);
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
        const goal = new goals.GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, 2);
        bot.pathfinder.setGoal(goal);

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

  // Step 0: Auto-eat before combat if HP is not full and food is available
  if (bot.health < 16 && bot.food < 20) {
    const foodItem = bot.inventory.items().find(i => isFoodItem(bot, i.name));
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
        return (aDist + aDepth * 3) - (bDist + bDepth * 3);
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
        return (aDist + aDepth * 3) - (bDist + bDepth * 3);
      })[0] || null;
  };

  let target = findTarget();
  if (!target) {
    return entityName
      ? `No ${entityName} found nearby`
      : "No hostile mobs nearby";
  }

  const targetName = target.name || "entity";
  const targetId = target.id;
  let attackCount = 0;
  const maxAttacks = 30; // Safety limit
  let lastKnownFightPos = target.position.clone();

  console.error(`[BotManager] Starting fight with ${targetName}`);

  // SAFETY: Cliff-edge check before combat — knockback from melee or ranged mobs can
  // push bot off cliff edges, causing fatal fall damage regardless of HP.
  // Bot1 Session 21b: "doomed to fall by Skeleton" during combat on elevated terrain.
  // Bot2 [2026-03-22]: "doomed to fall by Pillager/Skeleton" — knockback fall deaths.
  const cliffCheck = isNearCliffEdge(bot);
  if (cliffCheck.nearEdge && cliffCheck.maxFallDistance > 4) {
    console.error(`[Fight] CLIFF EDGE DETECTED: ${cliffCheck.maxFallDistance}-block drop (${cliffCheck.edgeDirections.join(",")}). Combat knockback is lethal. Refusing to fight.`);
    return `[REFUSED] Too dangerous to fight ${targetName} — you are near a cliff edge with a ${cliffCheck.maxFallDistance}-block drop (directions: ${cliffCheck.edgeDirections.join(", ")}). Combat knockback can push you off the edge, causing fatal fall damage. Move away from the cliff first (mc_navigate to safer terrain), then engage.`;
  }

  // Enderman strategy: approach to ~12 blocks if far, then stare to provoke
  let fightDistance = target.position.distanceTo(bot.entity.position);
  if (targetName === "enderman" && fightDistance > 4 && fightDistance <= 64) {
    // Approach closer first if far away for reliable provocation
    if (fightDistance > 16) {
      console.error(`[Fight] Enderman at ${fightDistance.toFixed(1)} blocks — approaching to 12 blocks first...`);
      applySafePathfinderSettings(bot);
      const approachGoal = new goals.GoalNear(target!.position.x, target!.position.y, target!.position.z, 12);
      bot.pathfinder.setGoal(approachGoal);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 8000);
        const check = setInterval(() => {
          const currentDist = target!.position.distanceTo(bot.entity.position);
          if (currentDist <= 14 || !bot.pathfinder.isMoving()) {
            clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
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
  {
    const postApproachHp = bot.health ?? 20;
    if (postApproachHp <= fleeHealthThreshold) {
      console.error(`[Fight] HP dropped to ${postApproachHp.toFixed(1)} during approach (flee threshold: ${fleeHealthThreshold}). Fleeing instead of fighting.`);
      bot.pathfinder.setGoal(null);
      await flee(managed, 20);
      return `Fled before combat! HP dropped to ${postApproachHp.toFixed(1)} during approach to ${targetName}. Attacked 0 times.` + getBriefStatus(bot);
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
  let lastApproachDist = Infinity; // Distance to target on last approach iteration
  while (attackCount < maxAttacks) {
    // Global timeout check
    if (Date.now() - fightStartTime > FIGHT_TIMEOUT_MS) {
      console.error(`[Fight] Global timeout (${FIGHT_TIMEOUT_MS / 1000}s) reached after ${attackCount} attacks. Aborting.`);
      bot.pathfinder.setGoal(null);
      // Clean up sprint state — may have been set for ranged mob approach.
      try { bot.setControlState("sprint", false); } catch { /* ignore */ }
      return `Fight timed out after ${attackCount} attacks (${FIGHT_TIMEOUT_MS / 1000}s). Target may be unreachable.` + getBriefStatus(bot);
    }

    // Check health - flee if low
    const health = bot.health;
    if (health <= fleeHealthThreshold) {
      console.error(`[BotManager] Health low (${health}), fleeing!`);
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
      const midCombatFood = bot.inventory.items().find((item: any) => isFoodItem(bot, item.name));
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
    // Abort and flee if any hostile is within 8 blocks during passive mob combat.
    if (entityName) {
      const passiveFoodMobs = ["cow", "pig", "chicken", "sheep", "rabbit", "horse", "donkey", "mule", "mooshroom", "llama", "goat", "salmon", "cod", "squid", "turtle"];
      const isPassiveHunt = passiveFoodMobs.some(p => entityName.toLowerCase().includes(p));
      if (isPassiveHunt) {
        const nearbyHostile = Object.values(bot.entities).find(e => {
          if (!e || e === bot.entity || !e.position) return false;
          const eName = e.name?.toLowerCase() ?? "";
          if (!isHostileMob(bot, eName)) return false;
          return e.position.distanceTo(bot.entity.position) < 8;
        });
        if (nearbyHostile) {
          const hostileName = nearbyHostile.name ?? "hostile";
          const hostileDist = nearbyHostile.position.distanceTo(bot.entity.position).toFixed(1);
          console.error(`[Fight] Hostile ${hostileName} at ${hostileDist}m during ${entityName} hunt! Aborting to flee.`);
          bot.pathfinder.setGoal(null);
          await flee(managed, 20);
          return `[HOSTILE ABORT] Fled from ${hostileName} (${hostileDist}m away) during ${entityName} hunt. Attacked ${attackCount} times. Clear hostiles first, then re-hunt.` + getBriefStatus(bot);
        }
      }
    }

    // Re-find target (it might have moved or died)
    target = Object.values(bot.entities).find(e => e.id === targetId) || null;
    if (!target) {
      // Auto-collect dropped items after kill
      // Move to last known position first (endermen teleport, drops spawn where they died)
      const distToLast = bot.entity.position.distanceTo(lastKnownFightPos);
      if (distToLast > 3) {
        console.error(`[Fight] Target died ${distToLast.toFixed(1)} blocks away, moving to collect drops`);
        applySafePathfinderSettings(bot);
        const collectGoal = new goals.GoalNear(lastKnownFightPos.x, lastKnownFightPos.y, lastKnownFightPos.z, 2);
        bot.pathfinder.setGoal(collectGoal);
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { bot.pathfinder.setGoal(null); resolve(); }, 5000);
          const check = setInterval(() => {
            if (bot.entity.position.distanceTo(lastKnownFightPos) < 3 || !bot.pathfinder.isMoving()) {
              clearInterval(check); clearTimeout(timeout); bot.pathfinder.setGoal(null); resolve();
            }
          }, 200);
        });
      }
      // Endermen teleport before dying — use wider search and longer wait
      // 800ms gives the server time to spawn drop item entities (was 500ms, too short)
      const isEnderman = targetName === "enderman";
      await delay(isEnderman ? 1000 : 800);
      let collectionResult = "Collection not attempted";
      try {
        collectionResult = await collectNearbyItems(managed, isEnderman ? { searchRadius: 16, waitRetries: 12 } : undefined);
        console.error(`[Fight] Item collection result: ${collectionResult}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Fight] CRITICAL: Item collection failed after kill: ${errMsg}`);
      }
      return `${targetName} defeated! Attacked ${attackCount} times. Items: ${collectionResult}` + getBriefStatus(bot);
    }
    // Track last known position (important for teleporting mobs like endermen)
    lastKnownFightPos = target.position.clone();

    const distance = target.position.distanceTo(bot.entity.position);

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
      if (isRangedTarget && !isBlaze) {
        bot.pathfinder.movements.allowSprinting = true;
        bot.setControlState("sprint", true);
      }
      bot.pathfinder.setGoal(new goals.GoalNear(
        target.position.x, target.position.y, target.position.z, isBlaze ? 4 : 2
      ));
      // Wait up to 1.5s for approach, with HP monitoring every 200ms.
      // Previous: 500ms fixed delay with no HP check — too short for sprint to close
      // distance, and ranged mobs dealt 8-10 damage during approach with no abort.
      // Bot1 [2026-03-22]: skeleton approach drained HP from 14 to 3 over multiple
      // 500ms approach iterations, each too short to close the gap.
      // New: 1.5s gives sprint time to close 5-7 blocks, and HP check every 200ms
      // catches damage early. Break immediately if within attack range.
      {
        const approachHpStart = bot.health ?? 20;
        for (let tick = 0; tick < 8; tick++) { // 8 * 200ms = 1.6s max
          await delay(200);
          const curTarget = Object.values(bot.entities).find(e => e.id === targetId);
          if (!curTarget) break; // Target died
          const curDist = curTarget.position.distanceTo(bot.entity.position);
          if (curDist <= attackRange) break; // Close enough to attack
          const approachHpNow = bot.health ?? 20;
          if (approachHpNow < approachHpStart - 6 || approachHpNow <= fleeHealthThreshold) {
            console.error(`[Fight] HP dropped during ranged approach (${approachHpStart.toFixed(1)} → ${approachHpNow.toFixed(1)}). Breaking approach.`);
            break;
          }
        }
      }
      // Clean up sprint state after approach completes
      if (isRangedTarget && !isBlaze) {
        bot.setControlState("sprint", false);
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
