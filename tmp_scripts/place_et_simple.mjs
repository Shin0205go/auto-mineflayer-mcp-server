/**
 * Simply place enchanting table at current position.
 * Find solid ground right below bot, place on it.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const Vec3 = require('vec3');
const fs = require('fs');

const LOGFILE = '/tmp/place_et2.log';
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

bot.once('spawn', async () => {
  await sleep(2000);

  log(`HP: ${bot.health} Food: ${bot.food}`);
  const pos = bot.entity.position;
  log(`Pos: (${Math.round(pos.x*10)/10},${Math.round(pos.y*10)/10},${Math.round(pos.z*10)/10})`);

  const etItem = bot.inventory.items().find(i => i.name === 'enchanting_table');
  if (!etItem) {
    log('No enchanting_table!');
    bot.quit();
    return;
  }

  // Navigate to a good open spot at base
  const mcMov = new Movements(bot);
  mcMov.canDig = true;
  mcMov.maxDropDown = 10;
  bot.pathfinder.setMovements(mcMov);

  await Promise.race([
    bot.pathfinder.goto(new GoalNear(9, 107, 4, 3)),
    new Promise(r => setTimeout(() => { bot.pathfinder.stop(); r(); }, 30000))
  ]).catch(() => {});

  await sleep(1000);
  const botPos = bot.entity.position;
  log(`At: (${Math.round(botPos.x*10)/10},${Math.round(botPos.y*10)/10},${Math.round(botPos.z*10)/10})`);

  // Scan 3x3 area for valid placement spots
  // Bot feet at y, standing on y-1
  const botFeetY = Math.floor(botPos.y);

  log(`Scanning for placement spots around bot...`);

  // Check all positions in 5x5x5 cube
  for (let dy = 0; dy >= -3; dy--) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const gx = Math.floor(botPos.x) + dx;
        const gy = botFeetY + dy - 1; // The ground block
        const gz = Math.floor(botPos.z) + dz;

        const groundBlock = bot.blockAt(new Vec3(gx, gy, gz));
        const spaceBlock1 = bot.blockAt(new Vec3(gx, gy + 1, gz));
        const spaceBlock2 = bot.blockAt(new Vec3(gx, gy + 2, gz));

        if (groundBlock && !['air', 'water', 'lava'].includes(groundBlock.name) &&
            spaceBlock1?.name === 'air' &&
            spaceBlock2?.name === 'air') {

          log(`Valid spot: ground at (${gx},${gy},${gz}) = ${groundBlock.name}`);

          // Navigate close to this spot
          await Promise.race([
            bot.pathfinder.goto(new GoalNear(gx, gy + 1, gz, 2)),
            new Promise(r => setTimeout(() => { bot.pathfinder.stop(); r(); }, 10000))
          ]).catch(() => {});

          // Place enchanting table
          const etNow = bot.inventory.items().find(i => i.name === 'enchanting_table');
          if (!etNow) { log('Lost enchanting_table!'); bot.quit(); return; }

          await bot.equip(etNow, 'hand');
          await bot.lookAt(new Vec3(gx, gy + 1, gz));

          const groundNow = bot.blockAt(new Vec3(gx, gy, gz));
          if (!groundNow || ['air', 'water'].includes(groundNow.name)) {
            log(`Ground changed: ${groundNow?.name}`);
            continue;
          }

          try {
            await bot.placeBlock(groundNow, new Vec3(0, 1, 0));
            await sleep(500);

            const placed = bot.blockAt(new Vec3(gx, gy + 1, gz));
            log(`Placed! Block at placement spot: ${placed?.name}`);

            if (placed?.name === 'enchanting_table') {
              log(`\n=== ENCHANTING TABLE PLACED at (${gx},${gy + 1},${gz}) ===`);
              await sleep(1000);
              bot.chat('[報告] Phase 5 完了条件達成！ enchanting_table 設置完了！ Phase 6 (Nether) の準備完了！');
              log('Phase 5 COMPLETE! Chat sent.');
              bot.quit();
              return;
            }
          } catch (e) {
            log(`Place attempt failed: ${e.message}`);
          }
        }
      }
    }
  }

  log('Could not find valid placement spot. Trying to place on chest...');

  // As last resort: use bot.chat to ask for help
  log('Trying manual placement...');

  // Use mc_place_block equivalent - place on any nearby block
  const nearBlock = bot.blockAt(botPos.offset(0, -1, 0));
  log(`Block below bot: ${nearBlock?.name}`);

  if (nearBlock && nearBlock.name !== 'air') {
    const etNow = bot.inventory.items().find(i => i.name === 'enchanting_table');
    if (etNow) {
      await bot.equip(etNow, 'hand');
      try {
        await bot.placeBlock(nearBlock, new Vec3(0, 1, 0));
        log('Placed on block below');
      } catch (e) {
        log(`Last resort place error: ${e.message}`);
      }
    }
  }

  log('\nFinal inventory:');
  bot.inventory.items().forEach(i => log(`  ${i.name} x${i.count}`));
  bot.quit();
});

bot.on('error', err => log(`Error: ${err.message}`));
bot.on('end', () => { log('Done'); process.exit(0); });
