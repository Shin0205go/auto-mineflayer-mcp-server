import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pkg from "mineflayer-pathfinder";
const { goals } = pkg;
import type { ManagedBot } from "./types.js";
import { isHostileMob, isFoodItem, isBedBlock } from "./minecraft-utils.js";
import { collectNearbyItems, equipArmor } from "./bot-items.js";

// Mamba向けの簡潔ステータスを付加するか（デフォルトはfalse=Claude向け）
const APPEND_BRIEF_STATUS = process.env.APPEND_BRIEF_STATUS === "true";

/**
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    target = entities.find(e => {
      if (!e || e === bot.entity) return false;
      const dist = e.position.distanceTo(bot.entity.position);
      if (dist > 64) return false;

      const name = (e.name || "").toLowerCase();
      const displayName = ((e as any).displayName || "").toLowerCase();

      return name === targetLower ||
             name.includes(targetLower) ||
             displayName === targetLower ||
             displayName.includes(targetLower);
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
    for (let i = 0; i < 30; i++) { // 30 * 300ms = 9s max wait
      await new Promise(r => setTimeout(r, 300));
      // Keep looking at the enderman
      const currentTarget = Object.values(bot.entities).find(e => e.id === target.id);
      if (!currentTarget) break; // enderman died or despawned
      await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.9, 0));
      const currentDist = currentTarget.position.distanceTo(bot.entity.position);
      if (currentDist < 4) {
        console.error(`[Attack] Enderman provoked, now ${currentDist.toFixed(1)} blocks away — attacking!`);
        target = currentTarget;
        break;
      }
    }
    distance = target.position.distanceTo(bot.entity.position);
  }

  // Move closer if needed
  if (distance > 3) {
    console.error(`[Attack] Target ${target.name} is ${distance.toFixed(1)} blocks away, moving closer...`);
    const goal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2);
    bot.pathfinder.setGoal(goal);

    // Scale timeout based on distance (1s per 4 blocks, min 5s, max 20s)
    const approachTimeout = Math.min(20000, Math.max(5000, Math.ceil(distance / 4) * 1000));
    // Wait for movement with proper tracking
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.setGoal(null);
        resolve();
      }, approachTimeout);

      const check = setInterval(() => {
        // Re-check target position (it may have moved)
        const currentDist = target.position.distanceTo(bot.entity.position);
        if (currentDist < 3.5 || !bot.pathfinder.isMoving()) {
          clearInterval(check);
          clearTimeout(timeout);
          bot.pathfinder.setGoal(null);
          resolve();
        }
      }, 200);
    });

    distance = target.position.distanceTo(bot.entity.position);
  }

  // Attack repeatedly until entity is dead or too far
  const targetId = target.id;
  let attacks = 0;
  const maxAttacks = 20; // Safety limit (20 attacks should kill most mobs)
  let lastKnownTargetPos = target.position.clone();

  try {
    while (attacks < maxAttacks) {
      // Check HP - flee if low (raised from 8 to 12 for better survival margin)
      if (bot.health <= 12) {
        console.error(`[Attack] HP low (${bot.health}), fleeing from ${target.name}!`);
        bot.pathfinder.setGoal(null);
        // Try to eat food while fleeing
        const food = bot.inventory.items().find(i => i.name === "bread" || i.name === "cooked_beef" || i.name === "cooked_porkchop" || i.name === "cooked_chicken" || i.name === "golden_apple" || i.name === "baked_potato" || i.name === "cooked_mutton" || i.name === "cooked_cod" || i.name === "cooked_salmon");
        if (food) {
          try {
            await bot.equip(food, "hand");
            bot.deactivateItem();
            await bot.consume();
          } catch (_) { /* ignore eat errors during flee */ }
        }
        return `Fled from ${target.name} at low HP (${bot.health}/20) after ${attacks} attacks. Eat food and try again.`;
      }

      // Check if target still exists
      const currentTarget = Object.values(bot.entities).find(e => e.id === targetId);
      if (!currentTarget) {
        // Auto-collect dropped items after kill
        // Move to last known position first (endermen teleport, drops spawn where they died)
        const distToLastPos = bot.entity.position.distanceTo(lastKnownTargetPos);
        if (distToLastPos > 3) {
          console.error(`[Attack] Target died ${distToLastPos.toFixed(1)} blocks away, moving to last known pos to collect drops`);
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
        await delay(500);
        try {
          await collectNearbyItems(managed);
        } catch (_) { /* ignore collection errors */ }
        return `Killed ${target.name} after ${attacks} attacks`;
      }
      // Track last known position (important for teleporting mobs like endermen)
      lastKnownTargetPos = currentTarget.position.clone();

      // Check if target is too far - if so, chase it instead of giving up
      const currentDist = currentTarget.position.distanceTo(bot.entity.position);
      if (currentDist > 6) {
        // Animals run away when attacked - chase them!
        if (currentDist > 32) {
          // Too far to chase
          return `Target ${target.name} escaped after ${attacks} attacks (distance: ${currentDist.toFixed(1)} blocks)`;
        }

        console.error(`[Attack] Target ${target.name} moved to ${currentDist.toFixed(1)} blocks, chasing...`);
        const goal = new goals.GoalNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, 2);
        bot.pathfinder.setGoal(goal);

        // Brief chase (don't wait too long)
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            bot.pathfinder.setGoal(null);
            resolve();
          }, 2000);

          const check = setInterval(() => {
            const checkDist = currentTarget.position.distanceTo(bot.entity.position);
            if (checkDist < 3.5 || !bot.pathfinder.isMoving()) {
              clearInterval(check);
              clearTimeout(timeout);
              bot.pathfinder.setGoal(null);
              resolve();
            }
          }, 100);
        });

        // Continue to attack after chasing
        continue;
      }

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
      const candidates = entities.filter(e => {
        if (!e || e === bot.entity) return false;
        const dist = e.position.distanceTo(bot.entity.position);
        if (dist > 64) return false;

        // Check various name properties
        const eName = e.name?.toLowerCase() || "";
        const eDisplayName = (e as any).displayName?.toLowerCase() || "";
        const eUsername = (e as any).username?.toLowerCase() || "";
        const eMobType = (e as any).mobType?.toLowerCase() || "";

        return eName === targetLower ||
               eDisplayName === targetLower ||
               eUsername === targetLower ||
               eMobType === targetLower ||
               eName.includes(targetLower) ||
               eDisplayName.includes(targetLower);
      });
      if (candidates.length === 0) return null;
      // Return closest match
      return candidates.sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
      )[0];
    }
    return entities
      .filter(e => isHostileMob(bot, e.name?.toLowerCase() || ""))
      .sort((a, b) =>
        a.position.distanceTo(bot.entity.position) -
        b.position.distanceTo(bot.entity.position)
      )[0] || null;
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

  // Enderman strategy: approach to ~12 blocks if far, then stare to provoke
  let fightDistance = target.position.distanceTo(bot.entity.position);
  if (targetName === "enderman" && fightDistance > 4 && fightDistance <= 64) {
    // Approach closer first if far away for reliable provocation
    if (fightDistance > 16) {
      console.error(`[Fight] Enderman at ${fightDistance.toFixed(1)} blocks — approaching to 12 blocks first...`);
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
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 300));
      const currentTarget = Object.values(bot.entities).find(e => e.id === targetId);
      if (!currentTarget) break;
      await bot.lookAt(currentTarget.position.offset(0, currentTarget.height * 0.9, 0));
      if (currentTarget.position.distanceTo(bot.entity.position) < 4) {
        console.error(`[Fight] Enderman provoked, now close — attacking!`);
        break;
      }
    }
  }

  // Step 3: Combat loop
  while (attackCount < maxAttacks) {
    // Check health - flee if low
    const health = bot.health;
    if (health <= fleeHealthThreshold) {
      console.error(`[BotManager] Health low (${health}), fleeing!`);
      bot.pathfinder.setGoal(null);
      await flee(managed, 20);
      return `Fled! Health was ${health}. Attacked ${attackCount} times.` + getBriefStatus(bot);
    }

    // Re-find target (it might have moved or died)
    target = Object.values(bot.entities).find(e => e.id === targetId) || null;
    if (!target) {
      // Auto-collect dropped items after kill
      // Move to last known position first (endermen teleport, drops spawn where they died)
      const distToLast = bot.entity.position.distanceTo(lastKnownFightPos);
      if (distToLast > 3) {
        console.error(`[Fight] Target died ${distToLast.toFixed(1)} blocks away, moving to collect drops`);
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
      await delay(500);
      try {
        await collectNearbyItems(managed);
      } catch (_) { /* ignore collection errors */ }
      return `${targetName} defeated! Attacked ${attackCount} times.` + getBriefStatus(bot);
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

    // Move closer if needed
    if (distance > 3.5) {
      bot.pathfinder.setGoal(new goals.GoalNear(
        target.position.x, target.position.y, target.position.z, 2
      ));
      await delay(500);
      continue;
    }

    // Attack!
    try {
      bot.pathfinder.setGoal(null); // Stop moving during attack
      await bot.lookAt(target.position.offset(0, target.height * 0.8, 0));
      bot.attack(target);
      attackCount++;
      console.error(`[BotManager] Hit ${targetName} (#${attackCount})`);
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
    await bot.equip(foodItem, "hand");
    await bot.consume();
    return `Ate ${foodItem.name}. Hunger: ${bot.food}/20` + getBriefStatus(bot);
  } catch (err) {
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
 */
export async function respawn(managed: ManagedBot, reason?: string): Promise<string> {
  const bot = managed.bot;
  const oldPos = bot.entity.position.clone();
  const oldHP = bot.health;
  const oldFood = bot.food;

  // Guard: Don't respawn if HP is still okay
  if (oldHP > 4) {
    const inventory = bot.inventory.items().map(i => `${i.name}(${i.count})`).join(", ");
    return `Refused to respawn: HP is ${oldHP}/20 (still survivable). Try eating, fleeing, or pillar_up first. Inventory: ${inventory}`;
  }

  console.error(`[Respawn] Intentional death requested. Reason: ${reason || "unspecified"}`);
  console.error(`[Respawn] Before: HP=${oldHP}, Food=${oldFood}, Pos=(${oldPos.x.toFixed(1)}, ${oldPos.y.toFixed(1)}, ${oldPos.z.toFixed(1)})`);

  // Use /kill command
  bot.chat(`/kill ${managed.username}`);

  // Wait for death and respawn
  await delay(3000);

  // Check new status
  const newPos = bot.entity.position;
  const newHP = bot.health;
  const newFood = bot.food;

  console.error(`[Respawn] After: HP=${newHP}, Food=${newFood}, Pos=(${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)})`);

  return `Respawned! Old: (${oldPos.x.toFixed(0)}, ${oldPos.y.toFixed(0)}, ${oldPos.z.toFixed(0)}) HP:${oldHP?.toFixed(0)}/20 Food:${oldFood}/20 → New: (${newPos.x.toFixed(0)}, ${newPos.y.toFixed(0)}, ${newPos.z.toFixed(0)}) HP:${newHP?.toFixed(0)}/20 Food:${newFood}/20. Reason: ${reason || "strategic reset"}. Inventory lost!`;
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
