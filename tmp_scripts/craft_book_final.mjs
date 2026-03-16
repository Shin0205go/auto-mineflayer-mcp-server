/**
 * Craft a book:
 * 1. Find 3 more sugar_cane (have 6, need 9 total for 3 paper)
 * 2. Navigate to crafting table at base
 * 3. Craft paper x3
 * 4. Craft book x1 (3 paper + 1 leather)
 * 5. Then craft enchanting_table (2 diamond + 4 obsidian + 1 book)
 *
 * Base crafting tables: (7,107,0), (11,94,8), (0,109,14)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalXZ } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/craft_book.log';
const log = (msg) => {
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOGFILE, line + '\n');
};

fs.writeFileSync(LOGFILE, '');

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Claude1',
  version: '1.21.4'
});
bot.loadPlugin(pathfinder);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCount(name) {
  return bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
}

async function tryNav(x, y, z, range = 3, timeoutMs = 30000) {
  const mcMov = new Movements(bot);
  mcMov.canDig = false;
  mcMov.maxDropDown = 8;
  bot.pathfinder.setMovements(mcMov);

  return Promise.race([
    bot.pathfinder.goto(new GoalNear(x, y, z, range)).then(() => true).catch(e => {
      log(`Nav err: ${e.message.substring(0, 60)}`);
      return false;
    }),
    sleep(timeoutMs).then(() => { bot.pathfinder.stop(); return false; })
  ]);
}

async function tryNavWithDig(x, y, z, range = 3, timeoutMs = 60000) {
  const mcMov = new Movements(bot);
  mcMov.canDig = true;
  mcMov.maxDropDown = 8;
  bot.pathfinder.setMovements(mcMov);

  return Promise.race([
    bot.pathfinder.goto(new GoalNear(x, y, z, range)).then(() => true).catch(e => {
      log(`Nav err (dig): ${e.message.substring(0, 60)}`);
      return false;
    }),
    sleep(timeoutMs).then(() => { bot.pathfinder.stop(); return false; })
  ]);
}

async function findAndGatherSugarCane(needed) {
  const mcData = require('minecraft-data')(bot.version);
  const sugarId = mcData.blocksByName['sugar_cane']?.id;
  if (!sugarId) return;

  let current = getCount('sugar_cane');
  log(`Sugar cane: ${current}, need ${needed}`);

  if (current >= needed) return;

  // Find sugar cane blocks
  const canes = bot.findBlocks({
    matching: sugarId,
    maxDistance: 300,
    count: 30
  });

  log(`Sugar cane blocks found: ${canes.length}`);

  for (const canePos of canes) {
    if (getCount('sugar_cane') >= needed) break;

    log(`Going to sugar_cane at (${canePos.x},${canePos.y},${canePos.z})`);
    const ok = await tryNav(canePos.x, canePos.y, canePos.z, 3, 20000);

    // Try to dig it
    const block = bot.blockAt(new Vec3(canePos.x, canePos.y, canePos.z));
    if (block && block.name === 'sugar_cane') {
      try {
        await bot.dig(block);
        await sleep(500);
        log(`Got sugar_cane: ${getCount('sugar_cane')}`);
      } catch (e) {
        log(`Dig err: ${e.message}`);
      }
    }
  }
}

async function craftAt(craftTable, itemName, count = 1) {
  const mcData = require('minecraft-data')(bot.version);
  const itemData = mcData.itemsByName[itemName];
  if (!itemData) { log(`Unknown item: ${itemName}`); return false; }

  const ctBlock = craftTable ? bot.blockAt(new Vec3(craftTable.x, craftTable.y, craftTable.z)) : null;

  const recipes = bot.recipesFor(itemData.id, null, 1, ctBlock);
  log(`Recipes for ${itemName}: ${recipes.length}`);

  if (recipes.length === 0) {
    log(`No recipe found for ${itemName}!`);
    return false;
  }

  try {
    await bot.craft(recipes[0], count, ctBlock);
    log(`Crafted ${itemName} x${count}: now have ${getCount(itemName)}`);
    return true;
  } catch (e) {
    log(`Craft ${itemName} error: ${e.message}`);
    return false;
  }
}

bot.once('spawn', async () => {
  await sleep(2000);

  log(`HP: ${bot.health} Food: ${bot.food}`);
  const pos = bot.entity.position;
  log(`Pos: (${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`);
  log(`\nInventory:`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  // Eat beef if hungry
  if (bot.food < 14) {
    const beefItem = bot.inventory.items().find(i => i.name === 'beef' || i.name === 'cooked_beef');
    if (beefItem) {
      log(`Eating ${beefItem.name}...`);
      await bot.equip(beefItem, 'hand').catch(() => {});
      await bot.consume().catch(e => log(`Eat error: ${e.message}`));
    }
  }

  // Step 1: Get enough sugar_cane (need 9, have 6)
  const sugarNeeded = 9;
  await findAndGatherSugarCane(sugarNeeded);
  log(`Sugar cane after gather: ${getCount('sugar_cane')}`);

  // Step 2: Navigate to base crafting table
  // Base crafting tables: (7,107,0), (11,94,8), (0,109,14)
  log(`\nNavigating to base...`);

  const baseCraftingTables = [
    {x: 7, y: 107, z: 0},
    {x: 11, y: 94, z: 8},
    {x: 0, y: 109, z: 14}
  ];

  // Try each crafting table
  let craftTableBlock = null;
  let craftTablePos = null;

  for (const ct of baseCraftingTables) {
    log(`Trying to reach crafting table at (${ct.x},${ct.y},${ct.z})...`);
    const ok = await tryNavWithDig(ct.x, ct.y, ct.z, 3, 60000);
    if (ok) {
      const block = bot.blockAt(new Vec3(ct.x, ct.y, ct.z));
      if (block && block.name === 'crafting_table') {
        craftTableBlock = block;
        craftTablePos = ct;
        log(`Found crafting table at (${ct.x},${ct.y},${ct.z})`);
        break;
      } else {
        log(`Block at (${ct.x},${ct.y},${ct.z}) is ${block?.name}, not crafting_table`);
      }
    }
  }

  // If no known crafting table, scan
  if (!craftTableBlock) {
    log(`Scanning for crafting tables...`);
    const mcData = require('minecraft-data')(bot.version);
    const ctId = mcData.blocksByName['crafting_table'].id;
    const tables = bot.findBlocks({ matching: ctId, maxDistance: 200, count: 5 });
    log(`Found ${tables.length} crafting tables nearby`);

    for (const t of tables) {
      const ok = await tryNavWithDig(t.x, t.y, t.z, 3, 30000);
      if (ok) {
        craftTableBlock = bot.blockAt(new Vec3(t.x, t.y, t.z));
        craftTablePos = t;
        break;
      }
    }
  }

  // If still no crafting table, place one from inventory or craft one
  if (!craftTableBlock) {
    log(`No crafting table found! Crafting a new one...`);

    // Craft planks first
    if (getCount('birch_planks') < 4 && getCount('birch_log') > 0) {
      await craftAt(null, 'birch_planks', 4);
    }

    // Craft crafting table
    if (getCount('birch_planks') >= 4) {
      await craftAt(null, 'crafting_table', 1);

      // Place it
      if (getCount('crafting_table') > 0) {
        const ctItem = bot.inventory.items().find(i => i.name === 'crafting_table');
        if (ctItem) {
          const placePos = bot.entity.position.offset(1, 0, 0);
          const refBlock = bot.blockAt(placePos.offset(0, -1, 0));
          try {
            await bot.equip(ctItem, 'hand');
            await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
            craftTableBlock = bot.blockAt(placePos);
            craftTablePos = placePos;
            log(`Placed crafting table`);
          } catch (e) {
            log(`Place error: ${e.message}`);
          }
        }
      }
    }
  }

  log(`\nCrafting table status: ${craftTableBlock ? 'found' : 'NOT FOUND'}`);

  // Step 3: Craft paper
  const sugarCane = getCount('sugar_cane');
  const paperNeeded = 3;
  const paperToCraft = Math.min(Math.floor(sugarCane / 3), paperNeeded);

  if (paperToCraft > 0) {
    log(`Crafting ${paperToCraft} paper from ${sugarCane} sugar_cane...`);
    await craftAt(craftTablePos, 'paper', paperToCraft);
  }

  log(`Paper: ${getCount('paper')}, Leather: ${getCount('leather')}`);

  // Step 4: Craft book
  if (getCount('paper') >= 3 && getCount('leather') >= 1) {
    log(`Crafting book!`);
    await craftAt(craftTablePos, 'book', 1);
    log(`Books: ${getCount('book')}`);
  } else {
    log(`Cannot craft book: paper=${getCount('paper')}/3, leather=${getCount('leather')}/1`);
  }

  // Step 5: Check enchanting table materials
  const book = getCount('book');
  const diamond = getCount('diamond');
  const obsidian = getCount('obsidian');

  log(`\n=== ENCHANTING TABLE MATERIALS ===`);
  log(`book: ${book}/1 ${book >= 1 ? '✅' : '❌'}`);
  log(`diamond: ${diamond}/2 ${diamond >= 2 ? '✅' : '❌'}`);
  log(`obsidian: ${obsidian}/4 ${obsidian >= 4 ? '❌ NEED TO GET' : '❌'}`);

  if (book >= 1 && diamond >= 2 && obsidian >= 4) {
    log(`\nCrafting enchanting_table!`);
    await craftAt(craftTablePos, 'enchanting_table', 1);
    log(`Enchanting tables: ${getCount('enchanting_table')}`);
  }

  // Final inventory
  log(`\n=== FINAL INVENTORY ===`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  bot.quit();
});

bot.on('error', err => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
