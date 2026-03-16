/**
 * Get obsidian x4 for enchanting table.
 * Method: Find natural obsidian OR create it with water+lava.
 *
 * Strategy:
 * 1. Search for existing obsidian blocks within 300 blocks
 * 2. If not found, use bucket to get water near lava at (-175,34,48)
 * 3. Pour water on lava to create obsidian
 * 4. Mine 4 obsidian with diamond pickaxe
 *
 * After getting obsidian:
 * - Craft enchanting_table (2 diamond + 4 obsidian + 1 book)
 * - Place it at base
 * - Phase 5 complete!
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalXZ } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/get_obsidian.log';
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

async function tryNav(x, y, z, range = 2, timeoutMs = 60000, canDig = true) {
  const mcMov = new Movements(bot);
  mcMov.canDig = canDig;
  mcMov.maxDropDown = 4; // Safe - avoid lava falls
  bot.pathfinder.setMovements(mcMov);

  return Promise.race([
    bot.pathfinder.goto(new GoalNear(x, y, z, range)).then(() => true).catch(e => {
      log(`Nav err: ${e.message.substring(0, 80)}`);
      return false;
    }),
    sleep(timeoutMs).then(() => { bot.pathfinder.stop(); return false; })
  ]);
}

async function eatIfNeeded() {
  if (bot.food > 14) return;
  const food = bot.inventory.items().find(i => ['cooked_beef', 'beef', 'bread', 'apple', 'carrot'].includes(i.name));
  if (food) {
    await bot.equip(food, 'hand').catch(() => {});
    bot.activateItem();
    await sleep(1700);
    bot.deactivateItem();
    log(`Ate ${food.name}, food=${bot.food}`);
  }
}

async function findNaturalObsidian() {
  const mcData = require('minecraft-data')(bot.version);
  const obsidianId = mcData.blocksByName['obsidian']?.id;
  if (!obsidianId) return [];

  const blocks = bot.findBlocks({
    matching: obsidianId,
    maxDistance: 300,
    count: 20
  });

  log(`Natural obsidian blocks found: ${blocks.length}`);
  return blocks;
}

async function mineObsidian(pos) {
  log(`Mining obsidian at (${pos.x},${pos.y},${pos.z})...`);

  const block = bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
  if (!block || block.name !== 'obsidian') {
    log(`Block is ${block?.name}, not obsidian`);
    return false;
  }

  // Equip diamond pickaxe
  const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
  if (!pick) {
    log('No diamond_pickaxe!');
    return false;
  }
  await bot.equip(pick, 'hand');

  // Navigate close
  await tryNav(pos.x, pos.y, pos.z, 3, 20000, false);

  try {
    await bot.dig(block);
    log(`Mined obsidian! Total: ${getCount('obsidian')}`);
    return true;
  } catch (e) {
    log(`Mining error: ${e.message}`);
    return false;
  }
}

async function makeObsidianFromLava() {
  log(`\n=== CREATING OBSIDIAN FROM LAVA ===`);
  log(`Lava known at (-175,34,48)`);

  // First, get water in bucket
  const bucket = bot.inventory.items().find(i => i.name === 'bucket');
  const waterBucket = bot.inventory.items().find(i => i.name === 'water_bucket');

  if (!bucket && !waterBucket) {
    log('No bucket! Cannot make obsidian this way.');
    return false;
  }

  const mcData = require('minecraft-data')(bot.version);

  if (!waterBucket) {
    log('Need to fill bucket with water...');

    // Find water blocks
    const waterId = mcData.blocksByName['water'].id;
    const waterBlocks = bot.findBlocks({
      matching: waterId,
      maxDistance: 100,
      count: 10
    });

    log(`Water blocks nearby: ${waterBlocks.length}`);

    let filledBucket = false;
    for (const wb of waterBlocks) {
      const wBlock = bot.blockAt(new Vec3(wb.x, wb.y, wb.z));
      // Make sure it's a source block (metadata/stateId check)
      if (wBlock?.name !== 'water') continue;

      // Navigate to water
      const ok = await tryNav(wb.x, wb.y, wb.z, 3, 15000, false);
      if (!ok) continue;

      // Fill bucket
      await bot.equip(bucket, 'hand').catch(() => {});
      try {
        await bot.activateBlock(wBlock);
        await sleep(1000);
        const wb2 = bot.inventory.items().find(i => i.name === 'water_bucket');
        if (wb2) {
          log('Bucket filled with water!');
          filledBucket = true;
          break;
        }
      } catch (e) {
        log(`Fill bucket error: ${e.message}`);
      }
    }

    if (!filledBucket) {
      log('Could not fill bucket with water. Trying to navigate to known lake...');
      // Navigate to lake at (-136, 51, 56)
      const ok = await tryNav(-136, 51, 56, 3, 60000, true);
      if (ok) {
        const wBlocks = bot.findBlocks({ matching: waterId, maxDistance: 5, count: 3 });
        for (const wb of wBlocks) {
          const wBlock = bot.blockAt(new Vec3(wb.x, wb.y, wb.z));
          if (wBlock?.name !== 'water') continue;
          await bot.equip(bucket, 'hand').catch(() => {});
          try {
            await bot.activateBlock(wBlock);
            await sleep(1000);
            if (bot.inventory.items().find(i => i.name === 'water_bucket')) {
              log('Filled bucket at lake!');
              filledBucket = true;
              break;
            }
          } catch (e) { log(`Fill err: ${e.message}`); }
        }
      }
    }

    if (!filledBucket) {
      log('FAILED to get water_bucket');
      return false;
    }
  }

  // Navigate to lava area (-175, 34, 48)
  log(`Navigating to lava at (-175,34,48)...`);
  await eatIfNeeded();

  const ok = await tryNav(-175, 37, 48, 5, 120000, true);
  log(`At lava area: ${JSON.stringify(bot.entity.position)}`);

  // Find lava blocks
  const lavaId = mcData.blocksByName['lava'].id;
  const lavaBlocks = bot.findBlocks({
    matching: lavaId,
    maxDistance: 20,
    count: 10
  });

  log(`Lava blocks found: ${lavaBlocks.length}`);

  if (lavaBlocks.length === 0) {
    log('No lava found near (-175,34,48)!');
    return false;
  }

  lavaBlocks.forEach(lb => log(`  lava at (${lb.x},${lb.y},${lb.z})`));

  // Find a lava block at the surface that we can pour water on
  // Look for lava with air above it
  const safeLava = lavaBlocks.filter(lb => {
    const above = bot.blockAt(new Vec3(lb.x, lb.y + 1, lb.z));
    return above && above.name === 'air';
  });

  log(`Safe lava blocks (air above): ${safeLava.length}`);

  if (safeLava.length === 0) {
    // Try any lava
    log('Using first lava block anyway');
  }

  const targetLava = safeLava.length > 0 ? safeLava[0] : lavaBlocks[0];
  log(`Target lava: (${targetLava.x},${targetLava.y},${targetLava.z})`);

  // Find a safe position to stand while pouring water
  // Must stand 1-2 blocks from lava, on solid ground
  // Check blocks around the target lava
  let standPos = null;
  for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[-1,-1],[1,-1],[-1,1]]) {
    const sx = targetLava.x + dx;
    const sz = targetLava.z + dz;
    const sy = targetLava.y;

    const groundBlock = bot.blockAt(new Vec3(sx, sy, sz));
    const feetBlock = bot.blockAt(new Vec3(sx, sy + 1, sz));
    const headBlock = bot.blockAt(new Vec3(sx, sy + 2, sz));

    if (groundBlock && !['air', 'lava', 'water'].includes(groundBlock.name) &&
        feetBlock?.name === 'air' && headBlock?.name === 'air') {
      standPos = {x: sx, y: sy + 1, z: sz};
      break;
    }

    // Check y+1 above lava
    const groundBlock2 = bot.blockAt(new Vec3(sx, sy + 1, sz));
    const feetBlock2 = bot.blockAt(new Vec3(sx, sy + 2, sz));
    if (groundBlock2 && !['air', 'lava', 'water'].includes(groundBlock2.name) &&
        feetBlock2?.name === 'air') {
      standPos = {x: sx, y: sy + 2, z: sz};
      break;
    }
  }

  if (standPos) {
    log(`Standing at (${standPos.x},${standPos.y},${standPos.z})`);
    await tryNav(standPos.x, standPos.y, standPos.z, 1, 15000, true);
  } else {
    log(`No safe stand position found, trying to navigate closer anyway`);
    await tryNav(targetLava.x, targetLava.y + 2, targetLava.z, 3, 15000, false);
  }

  // Pour water onto lava
  const waterBucketItem = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!waterBucketItem) {
    log('Lost water_bucket!');
    return false;
  }

  log(`Pouring water on lava...`);
  await bot.equip(waterBucketItem, 'hand');
  await bot.lookAt(new Vec3(targetLava.x, targetLava.y + 0.5, targetLava.z));

  // Place water - right-click on the lava block or adjacent block above
  const lavaBlock = bot.blockAt(new Vec3(targetLava.x, targetLava.y, targetLava.z));
  const blockAboveLava = bot.blockAt(new Vec3(targetLava.x, targetLava.y + 1, targetLava.z));

  try {
    // Try placing water by right-clicking the block above the lava
    if (blockAboveLava?.name === 'air') {
      await bot.placeBlock(lavaBlock, new Vec3(0, 1, 0));
    } else {
      bot.activateItem(); // Try direct activation
    }
    await sleep(2000);
    log('Water placed!');
  } catch (e) {
    log(`Water place error: ${e.message}`);
    // Try right-click on adjacent block
    bot.activateItem();
    await sleep(2000);
  }

  // Check if obsidian was created
  await sleep(1000);
  const newObsidian = bot.findBlocks({
    matching: mcData.blocksByName['obsidian'].id,
    maxDistance: 10,
    count: 10
  });
  log(`Obsidian blocks created: ${newObsidian.length}`);

  if (newObsidian.length === 0) {
    log('No obsidian created. Water may not have hit lava properly.');
    // Try direct lava approach
    return false;
  }

  // Mine the obsidian
  const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe');
  if (!pick) { log('No diamond pickaxe!'); return false; }
  await bot.equip(pick, 'hand');

  for (const obsPos of newObsidian.slice(0, 6)) {
    if (getCount('obsidian') >= 4) break;

    await tryNav(obsPos.x, obsPos.y, obsPos.z, 3, 15000, false);

    const block = bot.blockAt(new Vec3(obsPos.x, obsPos.y, obsPos.z));
    if (block?.name === 'obsidian') {
      log(`Mining obsidian at (${obsPos.x},${obsPos.y},${obsPos.z})`);
      try {
        await bot.dig(block);
        log(`Mined! Total obsidian: ${getCount('obsidian')}`);
      } catch (e) {
        log(`Mining error: ${e.message}`);
      }
    }

    await eatIfNeeded();
  }

  return getCount('obsidian') >= 4;
}

async function craftEnchantingTable() {
  log(`\n=== CRAFTING ENCHANTING TABLE ===`);

  const book = getCount('book');
  const diamond = getCount('diamond');
  const obsidian = getCount('obsidian');

  log(`book=${book}, diamond=${diamond}, obsidian=${obsidian}`);

  if (book < 1 || diamond < 2 || obsidian < 4) {
    log(`Insufficient materials!`);
    return false;
  }

  // Navigate to crafting table at base
  log(`Navigating to base crafting table...`);
  await tryNav(7, 107, 0, 3, 60000, true);

  const mcData = require('minecraft-data')(bot.version);
  const ctBlock = bot.blockAt(new Vec3(7, 107, 0));
  if (ctBlock?.name !== 'crafting_table') {
    log(`Block at (7,107,0) is ${ctBlock?.name}`);
    // Scan for closest crafting table
    const tables = bot.findBlocks({ matching: mcData.blocksByName['crafting_table'].id, maxDistance: 50, count: 3 });
    if (tables.length === 0) { log('No crafting table found!'); return false; }
    await tryNav(tables[0].x, tables[0].y, tables[0].z, 3, 30000, false);
    const ct = bot.blockAt(new Vec3(tables[0].x, tables[0].y, tables[0].z));
    return await doCraft(ct);
  }

  return await doCraft(ctBlock);

  async function doCraft(ct) {
    const etRecipe = bot.recipesFor(mcData.itemsByName['enchanting_table'].id, null, 1, ct);
    log(`Enchanting table recipes: ${etRecipe.length}`);
    if (etRecipe.length === 0) { log('No recipe!'); return false; }

    try {
      await bot.craft(etRecipe[0], 1, ct);
      log(`Enchanting table crafted! Count: ${getCount('enchanting_table')}`);
      return true;
    } catch (e) {
      log(`Craft error: ${e.message}`);
      return false;
    }
  }
}

bot.once('spawn', async () => {
  await sleep(2000);

  log(`=== GET OBSIDIAN START ===`);
  log(`HP: ${bot.health} Food: ${bot.food}`);
  const pos = bot.entity.position;
  log(`Pos: (${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)})`);
  log(`\nInventory:`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  // Check if already have obsidian
  let obsidian = getCount('obsidian');
  log(`\nObsidian: ${obsidian}/4`);

  if (obsidian < 4) {
    // Search for natural obsidian first
    const naturalObs = await findNaturalObsidian();

    if (naturalObs.length >= 4) {
      log(`Found natural obsidian! Mining...`);
      for (const pos of naturalObs) {
        if (getCount('obsidian') >= 4) break;
        await mineObsidian(pos);
        await eatIfNeeded();
      }
    }

    obsidian = getCount('obsidian');

    if (obsidian < 4) {
      log(`\nNeed more obsidian. Creating from lava+water...`);
      const created = await makeObsidianFromLava();
      obsidian = getCount('obsidian');
      log(`Obsidian after lava method: ${obsidian}`);
    }
  }

  // If we have all materials, craft enchanting table
  const book = getCount('book');
  const diamond = getCount('diamond');
  obsidian = getCount('obsidian');

  log(`\n=== MATERIALS CHECK ===`);
  log(`book: ${book}/1 ${book >= 1 ? 'OK' : 'MISSING'}`);
  log(`diamond: ${diamond}/2 ${diamond >= 2 ? 'OK' : 'MISSING'}`);
  log(`obsidian: ${obsidian}/4 ${obsidian >= 4 ? 'OK' : 'MISSING'}`);

  if (book >= 1 && diamond >= 2 && obsidian >= 4) {
    const crafted = await craftEnchantingTable();
    if (crafted) {
      log(`\n!!! PHASE 5 MATERIALS READY - Enchanting table crafted !!!`);
      log(`[報告] Phase 5 完了条件達成 - enchanting_table crafted!`);

      // Announce in chat
      bot.chat('[報告] Phase 5 完了条件達成！ enchanting_table を作成しました！');
    }
  } else {
    log(`\nCannot craft enchanting table yet. Missing materials.`);
    if (obsidian < 4) {
      log(`Still need obsidian x${4 - obsidian}`);
      log(`Lava location: (-175, 34, 48)`);
      log(`Water location: lake at (-136, 51, 56)`);
    }
  }

  log(`\n=== FINAL INVENTORY ===`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  bot.quit();
});

bot.on('error', err => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
