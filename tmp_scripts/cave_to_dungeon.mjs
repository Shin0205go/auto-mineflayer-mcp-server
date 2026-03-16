/**
 * Find natural cave entrance and navigate to dungeon
 * Current: (4.5, 84, -2.5), Dungeon: (87, 35, -62)
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock, GoalXZ } = goals;
import Vec3 from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);

  // Wait for day
  while (bot.time.timeOfDay > 12541) {
    await sleep(2000);
  }
  console.log('Day! time:', bot.time.timeOfDay);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 4;
  bot.pathfinder.setMovements(mov);

  // First place torches as we descend to prevent mob spawns
  // Equip torch
  const torches = bot.inventory.items().find(i => i.name === 'torch');
  console.log('Torches:', torches ? torches.count : 0);

  // Navigate near dungeon surface area (87, surface, -62)
  console.log('Moving to dungeon surface area...');
  bot.pathfinder.setGoal(new GoalXZ(87, -62));

  let surfaceReached = false;
  const posCheck = setInterval(() => {
    const p = bot.entity.position;
    if (Math.abs(p.x - 87) < 10 && Math.abs(p.z - (-62)) < 10) {
      surfaceReached = true;
      bot.pathfinder.setGoal(null);
    }
  }, 1000);

  await sleep(30000);
  clearInterval(posCheck);
  bot.pathfinder.setGoal(null);

  const surfacePos = bot.entity.position;
  console.log('Surface pos:', surfacePos, 'HP:', bot.health);

  if (Math.abs(surfacePos.x - 87) > 20 || Math.abs(surfacePos.z - (-62)) > 20) {
    console.log('Could not reach dungeon surface area. Trying direct approach...');

    // Try direct pathfinding to dungeon
    bot.pathfinder.setGoal(new GoalNear(87, 35, -62, 5));
    await sleep(60000);
    bot.pathfinder.setGoal(null);

    const dungeonPos = bot.entity.position;
    const dist = new Vec3(87, 35, -62).distanceTo(dungeonPos);
    console.log('After direct pathfind, dist to dungeon:', dist.toFixed(1), 'pos:', dungeonPos);
  }

  const finalPos = bot.entity.position;
  const distToDungeon = new Vec3(87, 35, -62).distanceTo(finalPos);
  console.log('Final pos:', finalPos, 'dist to dungeon:', distToDungeon.toFixed(1));
  console.log('HP:', bot.health, 'Food:', bot.food);

  if (distToDungeon < 5) {
    console.log('AT DUNGEON!');
    // Find chest
    const chestId = bot.registry.blocksByName['chest']?.id;
    if (chestId) {
      const chests = bot.findBlocks({ matching: chestId, maxDistance: 5, count: 5 });
      console.log('Chests within 5 blocks:', chests.length);
      for (const cp of chests) {
        const cb = bot.blockAt(cp);
        if (cb) {
          try {
            const chest = await bot.openContainer(cb);
            const items = chest.containerItems();
            console.log('Chest contents:', items.map(i => i.name + 'x' + i.count).join(', '));
            // Take books and useful items
            for (const item of items) {
              if (['book', 'enchanted_book', 'saddle', 'name_tag', 'iron_ingot', 'bread', 'leather'].some(v => item.name.includes(v))) {
                await bot.moveSlotItem(item.slot, -1).catch(() => {});
                console.log('Took:', item.name + 'x' + item.count);
              }
            }
            chest.close();
          } catch(e) {
            console.error('Chest error:', e.message);
          }
        }
      }
    }
  } else {
    console.log('Too far from dungeon. Try different approach.');
    // Drop down a 1x1 shaft if we're near surface
    const curPos = bot.entity.position;
    if (Math.abs(curPos.x - 87) < 5 && Math.abs(curPos.z - (-62)) < 5 && curPos.y > 40) {
      console.log('Above dungeon! Digging down shaft...');
      // Dig straight down toward y=35
      for (let y = Math.floor(curPos.y) - 1; y >= 36; y--) {
        const blockToMine = bot.blockAt(new Vec3(Math.floor(curPos.x), y, Math.floor(curPos.z)));
        if (blockToMine && blockToMine.name !== 'air') {
          try {
            await bot.dig(blockToMine);
          } catch(e) {
            console.log('Dig error at y=' + y + ':', e.message);
            break;
          }
        }
      }
    }
  }

  // Final inventory check
  const inv = bot.inventory.items();
  const books = inv.filter(i => i.name.includes('book'));
  console.log('Books in inventory:', books.map(i => i.name + 'x' + i.count).join(', ') || 'none');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => { console.log('BOT DIED!'); });
