/**
 * Survival first, then craft book.
 * 1. Check HP/food - eat immediately
 * 2. Navigate back to base (7,107,0 area)
 * 3. Find more sugar_cane if needed
 * 4. Craft: paper x3, book x1
 * 5. Then obsidian for enchanting table
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalXZ } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/survival_craft.log';
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

async function eatFood() {
  const foodItems = [
    'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
    'bread', 'apple',
    'beef', 'porkchop', 'chicken', 'mutton',
    'cooked_cod', 'cooked_salmon', 'potato', 'carrot', 'melon_slice'
  ];

  for (const foodName of foodItems) {
    const food = bot.inventory.items().find(i => i.name === foodName);
    if (food) {
      log(`Eating ${foodName}...`);
      try {
        await bot.equip(food, 'hand');
        await sleep(200);

        // Use raw activateItem to eat
        for (let i = 0; i < 3 && bot.food < 18; i++) {
          bot.activateItem();
          await sleep(1600); // Eating animation time
          if (bot.food >= 18) break;
        }

        log(`After eating: HP=${Math.round(bot.health*10)/10} Food=${bot.food}`);
        if (bot.food >= 14) return true;
      } catch (e) {
        log(`Eat error: ${e.message}`);
      }
    }
  }
  return false;
}

async function tryNavWithDig(x, y, z, range = 3, timeoutMs = 90000) {
  const mcMov = new Movements(bot);
  mcMov.canDig = true;
  mcMov.maxDropDown = 8;
  bot.pathfinder.setMovements(mcMov);

  return Promise.race([
    bot.pathfinder.goto(new GoalNear(x, y, z, range)).then(() => true).catch(e => {
      log(`Nav err: ${e.message.substring(0, 80)}`);
      return false;
    }),
    sleep(timeoutMs).then(() => { bot.pathfinder.stop(); return false; })
  ]);
}

bot.once('spawn', async () => {
  await sleep(3000);

  log(`=== SURVIVAL AND CRAFT START ===`);
  log(`HP: ${bot.health} Food: ${bot.food}`);
  const pos = bot.entity.position;
  log(`Pos: (${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`);

  log(`\nInventory:`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  // CRITICAL: Eat food immediately if HP < 15 or food < 14
  if (bot.health < 15 || bot.food < 14) {
    log(`\n--- EATING FOOD ---`);
    await eatFood();
    log(`After eat: HP=${Math.round(bot.health*10)/10} Food=${bot.food}`);
  }

  // Navigate back to base
  log(`\nNavigating to base...`);
  const baseTargets = [
    {x: 9, y: 96, z: 4},   // Chest location
    {x: 7, y: 107, z: 0},  // Crafting table
    {x: 5, y: 63, z: 49},  // Spawn area
  ];

  let atBase = false;
  for (const bt of baseTargets) {
    log(`Trying to reach (${bt.x},${bt.y},${bt.z})...`);
    const ok = await tryNavWithDig(bt.x, bt.y, bt.z, 5, 120000);
    if (ok) {
      log(`Reached base area!`);
      atBase = true;
      break;
    }
    // Eat again if needed during navigation
    if (bot.food < 8) await eatFood();
  }

  const botPos = bot.entity.position;
  log(`Position: (${Math.round(botPos.x)},${Math.round(botPos.y)},${Math.round(botPos.z)})`);

  // Find a crafting table
  const mcData = require('minecraft-data')(bot.version);
  const ctId = mcData.blocksByName['crafting_table'].id;
  const tables = bot.findBlocks({ matching: ctId, maxDistance: 100, count: 10 });
  log(`Crafting tables found: ${tables.length}`);
  tables.forEach(t => log(`  CT at (${t.x},${t.y},${t.z})`));

  let ctBlock = null;
  let ctPos = null;

  // Navigate to nearest crafting table
  for (const t of tables) {
    log(`Going to CT at (${t.x},${t.y},${t.z})...`);
    const ok = await tryNavWithDig(t.x, t.y, t.z, 3, 30000);
    if (ok) {
      ctBlock = bot.blockAt(new Vec3(t.x, t.y, t.z));
      ctPos = t;
      if (ctBlock?.name === 'crafting_table') break;
    }
  }

  // If no crafting table found, place one
  if (!ctBlock || ctBlock.name !== 'crafting_table') {
    log(`No crafting table reachable. Placing one from inventory or crafting...`);

    let ctItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!ctItem && getCount('birch_planks') >= 4) {
      // Craft a crafting table
      const ctRecipe = bot.recipesFor(mcData.itemsByName['crafting_table'].id, null, 1, null)[0];
      if (ctRecipe) {
        await bot.craft(ctRecipe, 1, null);
        ctItem = bot.inventory.items().find(i => i.name === 'crafting_table');
      }
    }

    if (ctItem) {
      await bot.equip(ctItem, 'hand');
      const placeRef = bot.blockAt(bot.entity.position.offset(1, -1, 0));
      if (placeRef) {
        try {
          await bot.placeBlock(placeRef, new Vec3(0, 1, 0));
          log(`Placed crafting table`);
          const placed = bot.blockAt(bot.entity.position.offset(1, 0, 0));
          ctBlock = placed;
          ctPos = bot.entity.position.offset(1, 0, 0);
        } catch (e) {
          log(`Place error: ${e.message}`);
        }
      }
    }
  }

  log(`CT status: ${ctBlock?.name} at ${ctPos ? JSON.stringify(ctPos) : 'unknown'}`);

  // Craft paper
  const sugarCane = getCount('sugar_cane');
  const paperToCraft = Math.floor(sugarCane / 3);
  log(`\nSugar cane: ${sugarCane} → can craft ${paperToCraft} paper`);

  if (paperToCraft > 0 && ctBlock?.name === 'crafting_table') {
    const paperRecipe = bot.recipesFor(mcData.itemsByName['paper'].id, null, 1, ctBlock)[0];
    if (paperRecipe) {
      log(`Crafting paper x${paperToCraft}...`);
      try {
        await bot.craft(paperRecipe, paperToCraft, ctBlock);
        log(`Paper crafted: ${getCount('paper')}`);
      } catch (e) {
        log(`Paper craft error: ${e.message}`);
        // Try one at a time
        for (let i = 0; i < paperToCraft; i++) {
          try {
            await bot.craft(paperRecipe, 1, ctBlock);
          } catch (e2) { break; }
        }
        log(`Paper after retry: ${getCount('paper')}`);
      }
    }
  }

  const paper = getCount('paper');
  const leather = getCount('leather');
  log(`\nPaper: ${paper}, Leather: ${leather}`);

  // Craft book
  if (paper >= 3 && leather >= 1 && ctBlock?.name === 'crafting_table') {
    const bookRecipe = bot.recipesFor(mcData.itemsByName['book'].id, null, 1, ctBlock)[0];
    if (bookRecipe) {
      log(`Crafting book!`);
      try {
        await bot.craft(bookRecipe, 1, ctBlock);
        log(`Book crafted! Count: ${getCount('book')}`);
      } catch (e) {
        log(`Book craft error: ${e.message}`);
      }
    } else {
      log(`No book recipe! Checking ingredients...`);
      // Debug: list what recipes are available
      const allBookRecipes = bot.recipesFor(mcData.itemsByName['book'].id, null, null, ctBlock);
      log(`All book recipes: ${allBookRecipes.length}`);
    }
  } else if (paper < 3) {
    log(`Need more paper. Have ${paper}/3. Sugar cane in area?`);
    // Look for more sugar cane
    const sugarId = mcData.blocksByName['sugar_cane']?.id;
    if (sugarId) {
      const canes = bot.findBlocks({ matching: sugarId, maxDistance: 200, count: 5 });
      log(`Sugar cane nearby: ${canes.length}`);
      for (const c of canes.slice(0, 3)) {
        log(`  at (${c.x},${c.y},${c.z})`);
        await tryNavWithDig(c.x, c.y, c.z, 2, 15000);
        const block = bot.blockAt(new Vec3(c.x, c.y, c.z));
        if (block?.name === 'sugar_cane') {
          try {
            await bot.dig(block);
            await sleep(500);
          } catch (e) { log(`Dig err: ${e.message}`); }
        }
        if (getCount('sugar_cane') >= 9) break;
      }

      // Try crafting paper again
      const newSugar = getCount('sugar_cane');
      const newPaper = Math.floor(newSugar / 3);
      if (newPaper > 0 && ctBlock?.name === 'crafting_table') {
        const paperRecipe = bot.recipesFor(mcData.itemsByName['paper'].id, null, 1, ctBlock)[0];
        if (paperRecipe) {
          await bot.craft(paperRecipe, newPaper, ctBlock).catch(e => log(`Paper err: ${e.message}`));
          log(`Paper now: ${getCount('paper')}`);
        }
      }

      // Try book again
      if (getCount('paper') >= 3 && leather >= 1 && ctBlock?.name === 'crafting_table') {
        const bookRecipe = bot.recipesFor(mcData.itemsByName['book'].id, null, 1, ctBlock)[0];
        if (bookRecipe) {
          await bot.craft(bookRecipe, 1, ctBlock).catch(e => log(`Book err: ${e.message}`));
          log(`Book: ${getCount('book')}`);
        }
      }
    }
  }

  // Check enchanting table status
  const book = getCount('book');
  const diamond = getCount('diamond');
  const obsidian = getCount('obsidian');

  log(`\n=== ENCHANTING TABLE STATUS ===`);
  log(`book: ${book}/1`);
  log(`diamond: ${diamond}/2`);
  log(`obsidian: ${obsidian}/4`);

  if (book >= 1 && diamond >= 2 && obsidian >= 4) {
    log(`ALL MATERIALS READY - Crafting enchanting_table!`);
    if (ctBlock?.name === 'crafting_table') {
      const etRecipe = bot.recipesFor(mcData.itemsByName['enchanting_table'].id, null, 1, ctBlock)[0];
      if (etRecipe) {
        await bot.craft(etRecipe, 1, ctBlock).catch(e => log(`ET craft err: ${e.message}`));
        log(`Enchanting table: ${getCount('enchanting_table')}`);
      }
    }
  } else if (book >= 1 && diamond >= 2) {
    log(`Need obsidian x${4 - obsidian} more`);
    log(`Lava found at (-175,34,48) - can make obsidian with bucket`);
  } else if (book === 0) {
    log(`Still need book. Have: paper=${getCount('paper')}, leather=${leather}, sugar_cane=${getCount('sugar_cane')}`);
  }

  log(`\n=== FINAL INVENTORY ===`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  bot.quit();
});

bot.on('error', err => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
