/**
 * Smart fishing: find water nearby, position correctly, fish.
 * Key insight: need pitch between -15° and -60° for bobber to land in water.
 * Bot must be close to water edge, facing water, with slight downward angle.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/smart_fish.log';
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

async function findAndFish() {
  const mcData = require('minecraft-data')(bot.version);
  const waterId = mcData.blocksByName['water'].id;

  const botPos = bot.entity.position;
  log(`Bot at: ${Math.round(botPos.x)},${Math.round(botPos.y)},${Math.round(botPos.z)}`);

  // Find water blocks within 100 blocks
  const waterBlocks = bot.findBlocks({
    matching: waterId,
    maxDistance: 100,
    count: 50
  });

  log(`Water blocks found: ${waterBlocks.length}`);

  if (waterBlocks.length === 0) {
    log('No water found!');
    return false;
  }

  // Filter to surface water only (y is highest water at that x,z)
  const surfaceWater = [];
  const checked = new Set();
  for (const wb of waterBlocks) {
    const key = `${wb.x},${wb.z}`;
    if (!checked.has(key)) {
      checked.add(key);
      // Check if block above is air (surface water)
      const blockAbove = bot.blockAt(new Vec3(wb.x, wb.y + 1, wb.z));
      if (blockAbove && blockAbove.name === 'air') {
        surfaceWater.push(wb);
      }
    }
  }

  log(`Surface water blocks: ${surfaceWater.length}`);
  if (surfaceWater.length === 0) {
    log('No surface water found!');
    return false;
  }

  // For each surface water block, find adjacent land at same y+1 level
  const fishingSpots = [];
  for (const wb of surfaceWater) {
    for (const [dx, dz] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const lx = wb.x + dx;
      const lz = wb.z + dz;
      const ly = wb.y; // Same level as water

      // Check if this is solid ground (can stand)
      const groundBlock = bot.blockAt(new Vec3(lx, ly, lz));
      const feetBlock = bot.blockAt(new Vec3(lx, ly + 1, lz));
      const headBlock = bot.blockAt(new Vec3(lx, ly + 2, lz));

      if (groundBlock && groundBlock.name !== 'air' && groundBlock.name !== 'water' &&
          feetBlock && feetBlock.name === 'air' &&
          headBlock && headBlock.name === 'air') {
        // Valid standing spot at same level as water
        const dist = botPos.distanceTo(new Vec3(lx, ly + 1, lz));
        fishingSpots.push({
          standX: lx,
          standY: ly + 1,
          standZ: lz,
          waterX: wb.x,
          waterY: wb.y,
          waterZ: wb.z,
          dist: dist
        });
      }

      // Also check y+1 land (one block higher than water)
      const groundBlock2 = bot.blockAt(new Vec3(lx, ly + 1, lz));
      const feetBlock2 = bot.blockAt(new Vec3(lx, ly + 2, lz));
      const headBlock2 = bot.blockAt(new Vec3(lx, ly + 3, lz));

      if (groundBlock2 && groundBlock2.name !== 'air' && groundBlock2.name !== 'water' &&
          feetBlock2 && feetBlock2.name === 'air' &&
          headBlock2 && headBlock2.name === 'air') {
        const dist = botPos.distanceTo(new Vec3(lx, ly + 2, lz));
        fishingSpots.push({
          standX: lx,
          standY: ly + 2,
          standZ: lz,
          waterX: wb.x,
          waterY: wb.y,
          waterZ: wb.z,
          dist: dist
        });
      }
    }
  }

  log(`Valid fishing spots: ${fishingSpots.length}`);

  if (fishingSpots.length === 0) {
    log('No valid fishing spots! Trying direct water entry...');

    // Alternative: stand IN water and fish outward
    const closestWater = surfaceWater.reduce((a, b) =>
      botPos.distanceTo(new Vec3(a.x, a.y, a.z)) < botPos.distanceTo(new Vec3(b.x, b.y, b.z)) ? a : b
    );
    log(`Closest water: ${JSON.stringify(closestWater)}`);

    // Try to get to the water edge
    const mcMov = new Movements(bot);
    mcMov.canDig = true;
    mcMov.maxDropDown = 5;
    bot.pathfinder.setMovements(mcMov);
    await bot.pathfinder.goto(new GoalNear(closestWater.x, closestWater.y, closestWater.z, 3))
      .catch(e => log(`Nav to water: ${e.message}`));

    return false;
  }

  // Sort by distance
  fishingSpots.sort((a, b) => a.dist - b.dist);
  log(`Best spots:`);
  fishingSpots.slice(0, 5).forEach(s =>
    log(`  Stand(${s.standX},${s.standY},${s.standZ})->Water(${s.waterX},${s.waterY},${s.waterZ}) dist=${Math.round(s.dist)}`)
  );

  const best = fishingSpots[0];
  log(`\nNavigating to best spot: (${best.standX},${best.standY},${best.standZ})`);

  const mcMov = new Movements(bot);
  mcMov.canDig = true;
  mcMov.maxDropDown = 8;
  bot.pathfinder.setMovements(mcMov);

  try {
    await bot.pathfinder.goto(new GoalNear(best.standX, best.standY, best.standZ, 1));
    log(`Arrived!`);
  } catch (e) {
    log(`Nav error: ${e.message}`);
    // Try next best spot
    if (fishingSpots.length > 1) {
      const next = fishingSpots[1];
      log(`Trying next spot: (${next.standX},${next.standY},${next.standZ})`);
      try {
        await bot.pathfinder.goto(new GoalNear(next.standX, next.standY, next.standZ, 1));
        log(`Arrived at backup spot`);
      } catch (e2) {
        log(`Also failed: ${e2.message}`);
        return false;
      }
    }
  }

  await new Promise(r => setTimeout(r, 500));
  const finalPos = bot.entity.position;
  log(`At: ${Math.round(finalPos.x*100)/100},${Math.round(finalPos.y*100)/100},${Math.round(finalPos.z*100)/100}`);

  // Equip fishing rod
  const rod = bot.inventory.items().find(i => i.name === 'fishing_rod');
  if (!rod) { log('No fishing rod!'); return false; }
  await bot.equip(rod, 'hand');
  log('Rod equipped');

  // Look toward water - aim at the center of the water at water level
  // The water is at y=best.waterY, bot eye is at y=finalPos.y + 1.62
  // Distance horizontally: ~dx, ~dz
  // We want pitch such that bobber lands in water, not too steep
  const lookTarget = new Vec3(best.waterX, best.waterY, best.waterZ);
  await bot.lookAt(lookTarget);
  log(`Looking at water: pitch=${Math.round(bot.entity.pitch * 180 / Math.PI)}° yaw=${Math.round(bot.entity.yaw * 180 / Math.PI)}°`);

  // Test cast to verify bobber position
  log(`\nTest cast...`);
  let testBobberPos = null;
  const testListener = (e) => {
    if (e.name === 'fishing_bobber') testBobberPos = e.position;
  };
  bot.on('entitySpawn', testListener);
  bot.activateItem();
  await new Promise(r => setTimeout(r, 2000));
  bot.off('entitySpawn', testListener);

  if (testBobberPos) {
    log(`Bobber at y=${Math.round(testBobberPos.y*100)/100} (water y=${best.waterY})`);
    const blockAtBobber = bot.blockAt(new Vec3(Math.floor(testBobberPos.x), Math.floor(testBobberPos.y), Math.floor(testBobberPos.z)));
    log(`Block at bobber: ${blockAtBobber?.name}`);

    if (blockAtBobber?.name !== 'water') {
      log(`Bobber NOT in water! Adjusting...`);
      bot.activateItem(); // Reel in
      await new Promise(r => setTimeout(r, 1000));

      // Try aiming further out (less steep angle)
      const furtherTarget = new Vec3(
        best.waterX + (best.waterX - finalPos.x) * 2,
        best.waterY,
        best.waterZ + (best.waterZ - finalPos.z) * 2
      );
      await bot.lookAt(furtherTarget);
      log(`Adjusted pitch: ${Math.round(bot.entity.pitch * 180 / Math.PI)}°`);

      // Test again
      let testBobberPos2 = null;
      const testListener2 = (e) => {
        if (e.name === 'fishing_bobber') testBobberPos2 = e.position;
      };
      bot.on('entitySpawn', testListener2);
      bot.activateItem();
      await new Promise(r => setTimeout(r, 2000));
      bot.off('entitySpawn', testListener2);

      if (testBobberPos2) {
        const block2 = bot.blockAt(new Vec3(Math.floor(testBobberPos2.x), Math.floor(testBobberPos2.y), Math.floor(testBobberPos2.z)));
        log(`Adjusted bobber: y=${Math.round(testBobberPos2.y*100)/100}, block=${block2?.name}`);
        if (block2?.name === 'water') {
          log(`SUCCESS with adjusted angle!`);
        }
      }

      bot.activateItem(); // Reel in
      await new Promise(r => setTimeout(r, 1000));
    }
  } else {
    log('No bobber spawned on test cast');
    bot.activateItem(); // Try to reel in anyway
    await new Promise(r => setTimeout(r, 500));
  }

  // Now do actual fishing
  log(`\nStarting fishing loop (40 attempts)...`);
  let caught = 0;
  let gotBook = false;
  const invBefore = {};
  bot.inventory.items().forEach(i => { invBefore[i.name] = (invBefore[i.name] || 0) + i.count; });

  for (let attempt = 1; attempt <= 40 && !gotBook; attempt++) {
    if (bot.health < 3) { log('HP critical! Stopping.'); break; }

    // Re-equip rod
    const currentRod = bot.inventory.items().find(i => i.name === 'fishing_rod');
    if (!currentRod) { log('Rod broke!'); break; }
    await bot.equip(currentRod, 'hand');

    // Re-aim
    const finalPos2 = bot.entity.position;
    const aimTarget = new Vec3(
      best.waterX + (best.waterX - finalPos2.x) * 1.5,
      best.waterY,
      best.waterZ + (best.waterZ - finalPos2.z) * 1.5
    );
    await bot.lookAt(aimTarget);

    try {
      log(`[${attempt}/40] HP=${Math.round(bot.health)} Food=${bot.food} Fishing...`);
      await Promise.race([
        bot.fish(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 37000))
      ]);
      caught++;
      log(`Caught!`);
    } catch (e) {
      if (e.message === 'timeout') {
        log(`Timeout (no bite in 37s), recasting`);
      } else if (e.message.includes('cancelled')) {
        log(`Cancelled: ${e.message}`);
      } else {
        log(`fish() error: ${e.message}`);
      }
    }

    // Check inventory
    const invAfter = {};
    bot.inventory.items().forEach(i => { invAfter[i.name] = (invAfter[i.name] || 0) + i.count; });
    for (const [name, count] of Object.entries(invAfter)) {
      const before = invBefore[name] || 0;
      if (count > before) {
        log(`  GOT: ${name} x${count - before}`);
        if (name === 'book' || name === 'enchanted_book') {
          gotBook = true;
          log(`  !!! BOOK! Phase 5 UNBLOCKED !!!`);
        }
        invBefore[name] = count;
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }

  log(`\nFishing complete: ${caught} catches total`);
  return gotBook;
}

bot.once('spawn', async () => {
  await new Promise(r => setTimeout(r, 2000));
  log(`HP: ${bot.health} Food: ${bot.food}`);
  log(`Pos: ${JSON.stringify(bot.entity.position)}`);

  const gotBook = await findAndFish();

  log(`\n=== FINAL INVENTORY ===`);
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));

  if (gotBook) {
    log('\n!!! SUCCESS: Got book! Ready for enchanting table! !!!');
  } else {
    log('\nNo book. Next: kill cows for leather + more sugar_cane for paper');
  }

  bot.quit();
});

bot.on('error', (err) => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
