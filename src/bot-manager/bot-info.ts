import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { ManagedBot, ChatMessage, GameEvent } from "./types.js";
import { isHostileMob, isNeutralMob, isPassiveMob, isFoodItem, isScaffoldBlock } from "./minecraft-utils.js";

/**
 * Get chat messages from a managed bot
 */
export function getChatMessages(managed: ManagedBot, clear: boolean = true): ChatMessage[] {
  const messages = [...managed.chatMessages];
  if (clear) {
    managed.chatMessages = [];
  }
  return messages;
}

/**
 * Get game events from a managed bot
 */
export function getGameEvents(managed: ManagedBot, clear: boolean = true, lastN?: number): GameEvent[] {
  let events = [...managed.gameEvents];
  if (lastN && lastN > 0) {
    events = events.slice(-lastN);
  }
  if (clear) {
    managed.gameEvents = [];
  }
  return events;
}

/**
 * Get detailed surroundings information
 */
export function getSurroundings(bot: Bot): string {
  const pos = bot.entity.position;
  const feetY = Math.floor(pos.y);
  const headY = feetY + 1;

  // Helper to get block at position
  const getBlock = (x: number, y: number, z: number) => {
    const block = bot.blockAt(new Vec3(x, y, z));
    return block?.name || "unknown";
  };

  // Helper to get direction string
  const getDirection = (dx: number, dy: number, dz: number): string => {
    const parts: string[] = [];
    if (dy > 0) parts.push("up");
    if (dy < 0) parts.push("down");
    if (dz < 0) parts.push("north");
    if (dz > 0) parts.push("south");
    if (dx > 0) parts.push("east");
    if (dx < 0) parts.push("west");
    return parts.join("-") || "here";
  };

  const x = Math.floor(pos.x);
  const z = Math.floor(pos.z);

  // Check all directions at feet and head level
  const directions = {
    north: { dx: 0, dz: -1 },
    south: { dx: 0, dz: 1 },
    east: { dx: 1, dz: 0 },
    west: { dx: -1, dz: 0 },
  };

  const passable: string[] = [];
  const blocked: string[] = [];

  for (const [dir, { dx, dz }] of Object.entries(directions)) {
    const feetBlock = getBlock(x + dx, feetY, z + dz);
    const headBlock = getBlock(x + dx, headY, z + dz);
    const groundBlock = getBlock(x + dx, feetY - 1, z + dz);

    const canPass = (feetBlock === "air" || feetBlock === "water") &&
                    (headBlock === "air" || headBlock === "water");
    const hasGround = groundBlock !== "air" && groundBlock !== "water";

    if (canPass && hasGround) {
      passable.push(dir);
    } else if (!canPass) {
      blocked.push(`${dir}(${feetBlock})`);
    } else {
      blocked.push(`${dir}(no ground)`);
    }
  }

  // Check above and below
  const above = getBlock(x, headY + 1, z);
  const below = getBlock(x, feetY - 1, z);

  // Check what's at feet level (in water? in lava?)
  const atFeet = getBlock(x, feetY, z);

  // === 環境情報 ===
  const lines: string[] = [];

  // === 生存ステータス（最優先確認） ===
  const health = bot.health ?? 20;
  const food = bot.food ?? 20;
  // oxygenLevel can be -1 in some states, clamp to 0-20
  const rawOxygen = (bot as any).oxygenLevel;
  const oxygen = (rawOxygen === undefined || rawOxygen < 0) ? 20 : Math.min(rawOxygen, 20);

  // Check inventory for food and supplies (using dynamic helpers)
  const isTorchItem = (name: string) => name.includes("torch") || name.includes("lantern");

  let foodCount = 0;
  let torchCount = 0;
  let scaffoldCount = 0;
  const foodNames: string[] = [];

  for (const item of bot.inventory.items()) {
    if (isFoodItem(bot, item.name)) {
      foodCount += item.count;
      if (!foodNames.includes(item.name)) foodNames.push(item.name);
    }
    if (isTorchItem(item.name)) {
      torchCount += item.count;
    }
    if (isScaffoldBlock(bot, item.name)) {
      scaffoldCount += item.count;
    }
  }

  // Critical warnings first
  const warnings: string[] = [];
  if (health <= 5) {
    warnings.push(`🚨 HP危険: ${health.toFixed(1)}/20 - 即時撤退！`);
  } else if (health <= 10) {
    warnings.push(`⚠️ HP低下: ${health.toFixed(1)}/20 - 食事か撤退を検討`);
  }
  if (food <= 6) {
    warnings.push(`🚨 空腹危険: ${food}/20 - 今すぐ食べる！`);
  } else if (food <= 14) {
    warnings.push(`⚠️ 空腹注意: ${food}/20 - 食事推奨`);
  }
  // Only warn about oxygen if bot is actually in water
  // oxygenLevel can be stale/unreliable when not underwater
  const blockAtFeet = bot.blockAt(bot.entity.position);
  const blockAtHead = bot.blockAt(bot.entity.position.offset(0, 1, 0));
  const isInWater = blockAtFeet?.name === "water" || blockAtHead?.name === "water";
  if (oxygen < 10 && isInWater) {
    warnings.push(`🚨 酸素不足: ${oxygen}/20 - 水上へ脱出！`);
  }
  if (foodCount === 0) {
    warnings.push(`⚠️ 食料なし - 採掘・探索前に食料確保必須！`);
  }

  if (warnings.length > 0) {
    lines.push(`## 🚨 警告`);
    for (const w of warnings) {
      lines.push(w);
    }
    lines.push(``);
  }

  // Survival status summary
  lines.push(`## 生存ステータス`);
  lines.push(`HP: ${health.toFixed(1)}/20, 空腹: ${food}/20`);
  lines.push(`食料: ${foodCount}個${foodNames.length > 0 ? ` (${foodNames.slice(0, 3).join(", ")})` : ""}`);
  lines.push(`松明: ${torchCount}個, 足場ブロック: ${scaffoldCount}個`);

  // Equipment info
  const slots = bot.inventory.slots;
  const head = slots[5]?.name || "なし";
  const chest = slots[6]?.name || "なし";
  const legs = slots[7]?.name || "なし";
  const feet = slots[8]?.name || "なし";
  const mainHand = bot.heldItem?.name || "なし";
  const offHand = slots[45]?.name || "なし";

  const armorParts = [head, chest, legs, feet].filter(a => a !== "なし");
  if (armorParts.length > 0) {
    lines.push(`装備: ${armorParts.join(", ")}`);
  } else {
    lines.push(`装備: なし ⚠️`);
  }
  lines.push(`手: ${mainHand}${offHand !== "なし" ? ` / 盾: ${offHand}` : ""}`);
  lines.push(``);

  // 基本位置
  lines.push(`## 現在地`);
  lines.push(`座標: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);

  // バイオーム
  try {
    const biome = bot.blockAt(pos)?.biome?.name || "unknown";
    lines.push(`バイオーム: ${biome}`);
  } catch {
    // biome not available
  }

  // 時刻と天気
  const time = bot.time.timeOfDay;
  const isDay = time < 12000 || time > 23000;
  const timeStr = isDay ? "昼" : "夜";
  lines.push(`時刻: ${timeStr} (${time})`);

  if (bot.isRaining) {
    lines.push(`天気: 雨${bot.thunderState > 0 ? "（雷雨）" : ""}`);
  }

  // 地形タイプ判定
  let terrainType = "地表";
  const skyLight = bot.blockAt(pos)?.skyLight ?? 15;
  if (pos.y < 0) {
    terrainType = "ディープダーク層";
  } else if (pos.y < 60 && skyLight < 4) {
    terrainType = "洞窟";
  } else if (atFeet === "water") {
    terrainType = "水中";
  } else if (pos.y > 100) {
    terrainType = "高所";
  }
  lines.push(`地形: ${terrainType}`);

  // 光レベル（参考情報のみ）
  const lightBlock = bot.blockAt(pos);
  const currentSkyLight = lightBlock?.skyLight ?? 0;
  const currentBlockLight = lightBlock?.light ?? 0;
  const effectiveLight = Math.max(currentSkyLight, currentBlockLight);
  lines.push(`光レベル: ${effectiveLight}`);

  lines.push(``);
  lines.push(`## 移動可能方向`);
  lines.push(`歩ける: ${passable.length > 0 ? passable.join(", ") : "なし"}`);
  lines.push(`壁: ${blocked.length > 0 ? blocked.join(", ") : "なし"}`);
  lines.push(`足元: ${below}, 頭上: ${above}`);

  if (atFeet !== "air") {
    lines.push(`足の位置: ${atFeet}`);
  }

  // Can jump up?
  const canJumpUp = above === "air";
  lines.push(`ジャンプ可: ${canJumpUp ? "はい" : "いいえ（頭上に障害物）"}`);

  // === 危険度評価 ===
  const dangers: string[] = [];

  // 落下危険
  if (below === "air") {
    dangers.push("落下危険（足元が空）");
  }

  // 溶岩チェック（周囲5ブロック）
  let lavaCount = 0;
  let lavaDir = "";
  for (let dx = -5; dx <= 5; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -5; dz <= 5; dz++) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (block?.name === "lava") {
          lavaCount++;
          if (!lavaDir) lavaDir = getDirection(dx, dy, dz);
        }
      }
    }
  }
  if (lavaCount > 0) {
    dangers.push(`溶岩あり (${lavaCount}ブロック, ${lavaDir}方向)`);
  }

  // 敵モブチェック（動的判定）
  const nearbyHostiles: string[] = [];
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    const dist = entity.position.distanceTo(pos);
    if (dist < 16 && isHostileMob(bot, entity.name?.toLowerCase() || "")) {
      const dir = getDirection(
        entity.position.x - pos.x,
        entity.position.y - pos.y,
        entity.position.z - pos.z
      );
      nearbyHostiles.push(`${entity.name}(${dist.toFixed(1)}m, ${dir})`);
    }
  }
  if (nearbyHostiles.length > 0) {
    dangers.push(`敵: ${nearbyHostiles.join(", ")}`);
  }

  if (dangers.length > 0) {
    lines.push(``);
    lines.push(`## ⚠️ 危険`);
    for (const d of dangers) {
      lines.push(`- ${d}`);
    }
  }

  // === 近くのエンティティ（動物など）動的判定 ===
  const nearbyFriendly: string[] = [];
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    const dist = entity.position.distanceTo(pos);
    if (dist < 20 && isPassiveMob(bot, entity.name?.toLowerCase() || "")) {
      const dir = getDirection(
        entity.position.x - pos.x,
        entity.position.y - pos.y,
        entity.position.z - pos.z
      );
      nearbyFriendly.push(`${entity.name}(${dist.toFixed(1)}m, ${dir})`);
    }
  }
  if (nearbyFriendly.length > 0) {
    lines.push(``);
    lines.push(`## 動物・村人`);
    lines.push(nearbyFriendly.slice(0, 10).join(", "));
  }

  // === 近くの資源（位置情報付き） ===
  const resourceBlocks = [
    "coal_ore", "iron_ore", "copper_ore", "gold_ore", "diamond_ore", "emerald_ore", "lapis_ore", "redstone_ore",
    "deepslate_coal_ore", "deepslate_iron_ore", "deepslate_copper_ore", "deepslate_gold_ore", "deepslate_diamond_ore", "deepslate_emerald_ore", "deepslate_lapis_ore", "deepslate_redstone_ore",
    "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log", "mangrove_log",
    "crafting_table", "furnace", "chest", "bed",
  ];

  interface ResourceInfo {
    count: number;
    nearest: { dx: number; dy: number; dz: number; dist: number };
  }
  const resources: Record<string, ResourceInfo> = {};

  const radius = 10;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const block = bot.blockAt(pos.offset(dx, dy, dz));
        if (block && resourceBlocks.includes(block.name)) {
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (!resources[block.name]) {
            resources[block.name] = { count: 0, nearest: { dx, dy, dz, dist } };
          }
          resources[block.name].count++;
          if (dist < resources[block.name].nearest.dist) {
            resources[block.name].nearest = { dx, dy, dz, dist };
          }
        }
      }
    }
  }

  if (Object.keys(resources).length > 0) {
    lines.push(``);
    lines.push(`## 近くの資源`);

    // 優先度順にソート（鉱石 > 木 > 設備）
    const oreOrder = ["diamond", "emerald", "gold", "iron", "copper", "coal", "lapis", "redstone"];
    const sorted = Object.entries(resources).sort((a, b) => {
      const aOre = oreOrder.findIndex(o => a[0].includes(o));
      const bOre = oreOrder.findIndex(o => b[0].includes(o));
      if (aOre !== -1 && bOre !== -1) return aOre - bOre;
      if (aOre !== -1) return -1;
      if (bOre !== -1) return 1;
      return a[1].nearest.dist - b[1].nearest.dist;
    });

    for (const [name, info] of sorted.slice(0, 12)) {
      const { dx, dy, dz, dist } = info.nearest;
      const dir = getDirection(dx, dy, dz);
      const coordStr = `(${Math.floor(pos.x + dx)}, ${Math.floor(pos.y + dy)}, ${Math.floor(pos.z + dz)})`;
      lines.push(`- ${name}: ${info.count}個, 最寄り${dist.toFixed(1)}m ${dir} ${coordStr}`);
    }
  } else {
    lines.push(``);
    lines.push(`## 近くの資源`);
    lines.push(`特になし`);
  }

  return lines.join("\n");
}

/**
 * Find blocks by name within a given distance
 */
export function findBlock(bot: Bot, blockName: string, maxDistance: number = 10): string {
  const pos = bot.entity.position;
  const searchName = blockName.toLowerCase();

  console.error(`[findBlock Debug] Searching for block: "${blockName}" (searchName: "${searchName}") within ${maxDistance} blocks`);

  // Use mineflayer's efficient bot.findBlocks API
  const mcData = (bot as any).registry;

  // Find all block IDs that match the search name
  const matchingIds: number[] = [];
  const blocksByName = mcData.blocksByName;
  if (blocksByName) {
    const blockDataForSearchName = blocksByName[searchName];

    for (const [name, blockData] of Object.entries(blocksByName)) {
      const lowerName = name.toLowerCase();
      if (lowerName === searchName ||
          lowerName.endsWith("_" + searchName) ||
          lowerName.includes(searchName)) {
        matchingIds.push((blockData as { id: number }).id);
      }
    }
  }

  const found: Array<{ x: number; y: number; z: number; distance: number; name: string }> = [];

  if (matchingIds.length > 0) {
    // Use bot.findBlocks - much faster than manual 3D loop
    const positions = bot.findBlocks({
      matching: matchingIds,
      maxDistance: maxDistance,
      count: 100,
    });

    for (const blockPos of positions) {
      const block = bot.blockAt(blockPos);
      if (block) {
        const dist = pos.distanceTo(blockPos);
        found.push({
          x: blockPos.x,
          y: blockPos.y,
          z: blockPos.z,
          distance: Math.round(dist * 10) / 10,
          name: block.name,
        });
      }
    }
  } else {
    // Fallback: manual search for blocks not in registry (shouldn't happen often)
    const searchRadius = Math.min(maxDistance, 32); // Cap manual search
    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -searchRadius; y <= searchRadius; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const blockPos = pos.offset(x, y, z);
          const block = bot.blockAt(blockPos);
          if (block && block.name !== "air") {
            const name = block.name.toLowerCase();
            const isMatch = name === searchName ||
                           name.endsWith("_" + searchName) ||
                           name.includes(searchName);
            if (isMatch) {
              const dist = pos.distanceTo(blockPos);
              if (dist <= maxDistance) {
                found.push({
                  x: Math.floor(blockPos.x),
                  y: Math.floor(blockPos.y),
                  z: Math.floor(blockPos.z),
                  distance: Math.round(dist * 10) / 10,
                  name: block.name,
                });
              }
            }
          }
        }
      }
    }
  }

  if (found.length === 0) {
    return `No ${blockName} found within ${maxDistance} blocks`;
  }

  // Sort with surface preference: blocks at or above bot's Y level are preferred over
  // underground blocks to prevent mc_navigate from routing into caves.
  // Bot1 [2026-03-22]: mc_navigate to coal_ore/crafting_table targeted underground blocks,
  // pathfinder routed through cave systems, bot got stuck/died.
  // Bot1 Session 44: navigated to block at Y=72, fell into cave, drowned.
  // Scoring: surface blocks (within 5 Y of bot or higher) sort by distance.
  // Underground blocks get a distance penalty proportional to depth below bot.
  // Penalty increased from 2x to 5x (2026-03-22): Bot1/Bot2/Bot3 still selected
  // underground blocks because 2x penalty was too weak — coal_ore at distance 5
  // but 15 blocks underground scored 35, while surface coal at distance 30 scored 30.
  // With 5x: underground coal scores 5 + 15*5 = 80, surface coal at 30 scores 30.
  const botY = pos.y;
  found.sort((a, b) => {
    const aDepth = Math.max(botY - a.y - 5, 0); // 0 if at/above bot Y-5
    const bDepth = Math.max(botY - b.y - 5, 0);
    // Add 5 blocks of distance penalty per block of depth underground
    const aScore = a.distance + aDepth * 5;
    const bScore = b.distance + bDepth * 5;
    return aScore - bScore;
  });

  // Return up to 10 nearest
  const nearest = found.slice(0, 10);
  const result = nearest.map(b => `${b.name} at (${b.x}, ${b.y}, ${b.z}) - ${b.distance} blocks`).join("\n");
  return `Found ${found.length} matching "${blockName}". Nearest:\n${result}`;
}

/**
 * Find nearby entities (mobs, animals, players)
 */
export function findEntities(bot: Bot, entityType?: string, maxDistance: number = 32): string {
  const pos = bot.entity.position;

  // Get all entities
  const entities = Object.values(bot.entities)
    .filter(e => {
      if (!e || e === bot.entity) return false;
      const dist = pos.distanceTo(e.position);
      if (dist > maxDistance) return false;
      if (entityType) {
        const name = (e.name || "").toLowerCase();
        const displayName = (e.displayName || "").toLowerCase();
        const type = (e.type || "").toLowerCase();
        const searchType = entityType.toLowerCase();

        // Exact match is always OK
        if (name === searchType || displayName === searchType || type === searchType) {
          return true;
        }

        // Substring match — but reject if target is passive and entity is hostile.
        // Same fix as fight() in bot-survival.ts: "pig" must NOT match "zombified_piglin".
        // Bot1 death: fight("pig") matched zombified_piglin; same risk in findEntities.
        const substringMatch =
          name.includes(searchType) ||
          displayName.includes(searchType) ||
          type.includes(searchType);
        if (substringMatch) {
          const targetIsHostile = isHostileMob(bot, searchType);
          if (!targetIsHostile && isHostileMob(bot, name)) {
            return false; // passive target should not match hostile entity
          }
          if (isNeutralMob(name)) {
            return false; // neutral mobs (zombified_piglin) require exact match only
          }
          return true;
        }

        // Also check namespace and display name format patterns
        const namespacedSearch = `minecraft:${searchType}`;
        if (name.includes(namespacedSearch) || type.includes(namespacedSearch)) {
          return true;
        }

        return false;
      }
      return true;
    })
    .map(e => ({
      name: e.name || e.displayName || "unknown",
      type: e.type,
      position: e.position,
      distance: pos.distanceTo(e.position),
    }))
    // Sort with surface preference: penalize underground entities to prevent navigation
    // into caves when searching for animals/mobs. Same pattern as findBlock's depth penalty.
    // Bot1 Sessions 31-34,44: mc_navigate to cow/pig picked underground entity, pathfinder
    // routed through cave, bot got trapped/killed. Bot3 #3: fight("cow") targeted underground cow.
    .sort((a, b) => {
      const aDepth = Math.max(pos.y - a.position.y - 5, 0);
      const bDepth = Math.max(pos.y - b.position.y - 5, 0);
      return (a.distance + aDepth * 5) - (b.distance + bDepth * 5);
    });

  if (entities.length === 0) {
    if (entityType) {
      return `No ${entityType} found within ${maxDistance} blocks`;
    }
    return `No entities found within ${maxDistance} blocks`;
  }

  // Group by type
  const grouped: Record<string, typeof entities> = {};
  for (const e of entities) {
    const key = e.name;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  }

  const lines = [`Entities within ${maxDistance} blocks:`];
  for (const [name, list] of Object.entries(grouped)) {
    const nearest = list[0];
    lines.push(`- ${name} x${list.length} (nearest: ${nearest.distance.toFixed(1)} blocks at ${Math.floor(nearest.position.x)}, ${Math.floor(nearest.position.y)}, ${Math.floor(nearest.position.z)})`);
  }

  return lines.join("\n");
}

/**
 * List dropped items near the bot
 */
export function listDroppedItems(bot: Bot, range: number = 10): string {
  const botPos = bot.entity.position;

  const items = Object.values(bot.entities)
    .filter(entity => {
      if (!entity || entity === bot.entity) return false;
      const dist = entity.position.distanceTo(botPos);
      return dist < range && entity.name === "item";
    })
    .map(entity => {
      const dist = entity.position.distanceTo(botPos);
      // Try to get item info from metadata
      const metadata = entity.metadata;
      let itemName = "unknown";
      if (metadata && Array.isArray(metadata)) {
        // Item entity metadata slot 8 contains the item stack
        const itemStack = metadata.find((m: unknown) =>
          m && typeof m === "object" && "itemId" in (m as object)
        );
        if (itemStack && typeof itemStack === "object" && "itemId" in itemStack) {
          itemName = `item_id:${(itemStack as { itemId: number }).itemId}`;
        }
      }
      return {
        entityId: entity.id,
        name: itemName,
        distance: dist.toFixed(1),
        position: {
          x: entity.position.x.toFixed(1),
          y: entity.position.y.toFixed(1),
          z: entity.position.z.toFixed(1),
        },
      };
    })
    .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

  if (items.length === 0) {
    return `No dropped items within ${range} blocks. Bot position: (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)})`;
  }

  return JSON.stringify({
    botPosition: { x: botPos.x.toFixed(1), y: botPos.y.toFixed(1), z: botPos.z.toFixed(1) },
    droppedItems: items,
  }, null, 2);
}

/**
 * Get bot inventory
 */
export function getInventory(bot: Bot): { name: string; count: number }[] {
  const items: { name: string; count: number }[] = [];
  for (const item of bot.inventory.items()) {
    items.push({ name: item.name, count: item.count });
  }
  return items;
}

/**
 * Get bot status (health, hunger, position, etc.)
 */
export function getStatus(bot: Bot): string {
  const health = bot.health?.toFixed(1) ?? "unknown";
  const food = bot.food ?? "unknown";
  const heldItem = bot.heldItem?.name ?? "empty";

  // Get armor info
  const armor = bot.inventory.slots
    .filter((slot, i) => i >= 5 && i <= 8 && slot)
    .map(slot => slot?.name)
    .filter(Boolean);

  return JSON.stringify({
    health: `${health}/20`,
    hunger: `${food}/20`,
    heldItem,
    armor: armor.length > 0 ? armor : ["none"],
    position: {
      x: bot.entity.position.x.toFixed(1),
      y: bot.entity.position.y.toFixed(1),
      z: bot.entity.position.z.toFixed(1),
    },
  });
}

/**
 * Get detailed equipment info for each slot
 */
export function getEquipment(bot: Bot): string {
  const slots = bot.inventory.slots;

  // Mineflayer inventory slots for equipment:
  // 5: helmet, 6: chestplate, 7: leggings, 8: boots
  // 45: off-hand
  const equipment = {
    head: slots[5]?.name || "(empty)",
    chest: slots[6]?.name || "(empty)",
    legs: slots[7]?.name || "(empty)",
    feet: slots[8]?.name || "(empty)",
    mainHand: bot.heldItem?.name || "(empty)",
    offHand: slots[45]?.name || "(empty)",
  };

  const lines = [
    `## Equipment`,
    `- Head: ${equipment.head}`,
    `- Chest: ${equipment.chest}`,
    `- Legs: ${equipment.legs}`,
    `- Feet: ${equipment.feet}`,
    `- Main Hand: ${equipment.mainHand}`,
    `- Off Hand: ${equipment.offHand}`,
  ];

  return lines.join("\n");
}

/**
 * Get nearby entities with filtering
 */
export function getNearbyEntities(bot: Bot, range: number = 16, type: string = "all"): string {
  const entities = Object.values(bot.entities)
    .filter(entity => {
      if (!entity || entity === bot.entity) return false;
      const dist = entity.position.distanceTo(bot.entity.position);
      if (dist > range) return false;

      const name = entity.name?.toLowerCase() || "";

      switch (type) {
        case "hostile":
          return isHostileMob(bot, name);
        case "passive":
          return isPassiveMob(bot, name);
        case "player":
          return entity.type === "player";
        default:
          return true;
      }
    })
    .map(entity => ({
      name: entity.name,
      type: isHostileMob(bot, entity.name?.toLowerCase() || "") ? "hostile" :
            entity.type === "player" ? "player" : "passive",
      distance: entity.position.distanceTo(bot.entity.position).toFixed(1),
      position: {
        x: entity.position.x.toFixed(1),
        y: entity.position.y.toFixed(1),
        z: entity.position.z.toFixed(1),
      },
    }))
    .sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

  if (entities.length === 0) {
    return `No ${type === "all" ? "" : type + " "}entities within ${range} blocks`;
  }

  return JSON.stringify(entities, null, 2);
}

/**
 * Get current biome information
 */
export async function getBiome(bot: Bot): Promise<string> {
  const pos = bot.entity.position;
  const block = bot.blockAt(pos);

  if (!block) {
    return "Cannot determine biome - chunk not loaded";
  }

  const biome = block.biome;

  if (!biome) {
    return "Biome information not available";
  }

  // Get biome name from ID using minecraft-data
  let biomeName = biome.name;
  if (!biomeName && biome.id !== undefined) {
    try {
      const minecraftData = await import("minecraft-data");
      const mcData = minecraftData.default(bot.version);
      const biomeData = mcData.biomes?.[biome.id] || (mcData as any).biomesArray?.find((b: any) => b.id === biome.id);
      biomeName = biomeData?.name || `biome_${biome.id}`;
    } catch {
      biomeName = `biome_${biome.id}`;
    }
  }
  biomeName = biomeName || "unknown";

  // Biome info
  const lines = [
    `Current biome: ${biomeName}`,
    `Position: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`,
  ];

  // Add biome characteristics if available
  if (biome.temperature !== undefined) {
    lines.push(`Temperature: ${biome.temperature}`);
  }
  if (biome.rainfall !== undefined) {
    lines.push(`Rainfall: ${biome.rainfall}`);
  }

  // Sheep spawn biomes hint - use pattern matching for grass/forest biomes
  // Sheep spawn in grassy biomes with moderate temperature
  const isSheepBiome = (name: string): boolean => {
    const grassyPatterns = ["plains", "meadow", "forest", "taiga", "savanna", "grove"];
    const excludePatterns = ["desert", "badlands", "ocean", "swamp", "jungle", "dark_forest"];
    if (excludePatterns.some(p => name.includes(p))) return false;
    return grassyPatterns.some(p => name.includes(p));
  };

  // NOTE: Removed "★ This biome can spawn sheep!" hint — it caused agents to waste
  // turns searching for sheep in birch_forest where none exist (passive mobs only spawn
  // during world generation in Java Edition and don't respawn naturally).

  return lines.join("\n");
}
