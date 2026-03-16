/**
 * Safely access dungeon chests at (87, 35, -62)
 * Wait for day, then descend carefully
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock, GoalXZ } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Time:', bot.time.timeOfDay);

  // Wait for daytime
  while (bot.time.timeOfDay > 12541) {
    console.log('Waiting for day... time:', bot.time.timeOfDay);
    await sleep(3000);
  }
  console.log('It is now DAY! Time:', bot.time.timeOfDay);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 4;
  bot.pathfinder.setMovements(mov);

  // First go to the surface position above the dungeon (87, surface_y, -62)
  console.log('Moving to dungeon surface area (87, ?, -62)...');
  bot.pathfinder.setGoal(new GoalXZ(87, -62));
  await sleep(30000);
  bot.pathfinder.setGoal(null);

  const pos = bot.entity.position;
  console.log('Surface pos:', pos, 'HP:', bot.health, 'Food:', bot.food);

  // Check current time
  const t = bot.time.timeOfDay;
  if (t > 12541) {
    console.log('Night again! Waiting...');
    // Actually just proceed - dungeon is underground anyway
  }

  // Now go underground toward dungeon
  // Dungeon chest at y=35, we need to dig down
  console.log('Going toward chest at (87, 35, -62)...');

  // Navigate toward the chest position
  bot.pathfinder.setGoal(new GoalNear(87, 35, -62, 3));
  await sleep(60000);
  bot.pathfinder.setGoal(null);

  const deepPos = bot.entity.position;
  console.log('Deep pos:', deepPos, 'HP:', bot.health, 'Food:', bot.food);

  const distToChest = Math.sqrt(
    Math.pow(deepPos.x - 87, 2) + Math.pow(deepPos.y - 35, 2) + Math.pow(deepPos.z + 62, 2)
  );
  console.log('Distance to chest:', distToChest.toFixed(1));

  if (distToChest < 5) {
    console.log('At dungeon! Looking for chest...');
    const chestBlock = bot.blockAt({ x: 87, y: 35, z: -62 });
    console.log('Block at (87,35,-62):', chestBlock ? chestBlock.name : 'null');

    const chest2Block = bot.blockAt({ x: 88, y: 35, z: -63 });
    console.log('Block at (88,35,-63):', chest2Block ? chest2Block.name : 'null');

    // Search nearby for chests
    const chestId = bot.registry.blocksByName['chest']?.id;
    if (chestId) {
      const nearChests = bot.findBlocks({ matching: chestId, maxDistance: 5, count: 5 });
      console.log('Chests within 5 blocks:', nearChests.length, nearChests.map(c => c.toString()).join(', '));

      for (const cp of nearChests) {
        const cb = bot.blockAt(cp);
        if (cb && cb.name === 'chest') {
          console.log('Trying to open chest at:', cp);
          try {
            const chest = await bot.openContainer(cb);
            const items = chest.containerItems();
            console.log('Chest contents:', items.map(i => i.name + 'x' + i.count).join(', ') || 'empty');
            chest.close();
          } catch (e) {
            console.error('Open failed:', e.message);
          }
        }
      }
    }
  }

  console.log('=== DONE ===');
  const inv = bot.inventory.items();
  const books = inv.filter(i => i.name === 'book' || i.name.includes('book'));
  const leather = inv.filter(i => i.name === 'leather');
  console.log('Books:', books.map(i => i.name + 'x' + i.count).join(', ') || 'none');
  console.log('Leather:', leather.map(i => 'x' + i.count).join(', ') || 'none');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => {
  console.log('BOT DIED! Respawned.');
});
