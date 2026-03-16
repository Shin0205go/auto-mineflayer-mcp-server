/**
 * We're near dungeon at (89, 39, -63)
 * Find and open the chests at (87, 35, -62) and (88, 35, -63)
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock } = goals;
import Vec3 from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 4;
  bot.pathfinder.setMovements(mov);

  // Navigate to chest at (87, 35, -62)
  console.log('Going to chest position...');
  bot.pathfinder.setGoal(new GoalNear(87, 35, -62, 2));
  await sleep(40000);
  bot.pathfinder.setGoal(null);

  const pos = bot.entity.position;
  console.log('Pos:', pos, 'HP:', bot.health);

  const distToChest = new Vec3(87, 35, -62).distanceTo(pos);
  console.log('Distance to chest:', distToChest.toFixed(1));

  // Try to find chests in wider range
  const chestId = bot.registry.blocksByName['chest']?.id;
  if (chestId) {
    const chests = bot.findBlocks({ matching: chestId, maxDistance: 10, count: 10 });
    console.log('Chests within 10 blocks:', chests.length, chests.map(c => c.toString()).join(', '));

    for (const cp of chests) {
      // Skip the base chest
      if (cp.x === 9 && cp.y === 96 && cp.z === 4) continue;

      const cb = bot.blockAt(cp);
      if (!cb) continue;
      console.log('Opening chest at:', cp, 'block:', cb.name);

      try {
        // Navigate right next to it
        bot.pathfinder.setGoal(new GoalNear(cp.x, cp.y, cp.z, 1));
        await sleep(5000);
        bot.pathfinder.setGoal(null);

        const chest = await bot.openContainer(cb);
        const items = chest.containerItems();
        console.log('Chest contents:', items.length > 0 ? items.map(i => i.name + ' x' + i.count).join(', ') : 'empty');

        // Take everything useful
        const useful = ['book', 'enchanted_book', 'saddle', 'name_tag', 'iron_ingot', 'golden_apple',
                       'bread', 'wheat', 'bucket', 'leather', 'string', 'music_disc', 'bow', 'arrow'];
        for (const item of items) {
          if (useful.some(u => item.name.includes(u))) {
            try {
              await bot.moveSlotItem(item.slot, -1);
              console.log('Took:', item.name + ' x' + item.count);
            } catch(e) {
              console.log('Cannot take', item.name, ':', e.message);
            }
          }
        }
        chest.close();
        await sleep(500);
      } catch(e) {
        console.error('Error with chest at', cp.toString() + ':', e.message);
      }
    }
  }

  // Report what we got
  const inv = bot.inventory.items();
  const books = inv.filter(i => i.name === 'book' || i.name === 'enchanted_book');
  const leather = inv.filter(i => i.name === 'leather');
  const food = inv.filter(i => ['bread', 'wheat', 'golden_apple', 'apple'].includes(i.name));

  console.log('=== RESULTS ===');
  console.log('HP:', bot.health, 'Food:', bot.food);
  console.log('Books:', books.map(i => i.name + 'x' + i.count).join(', ') || 'NONE');
  console.log('Leather:', leather.map(i => 'x' + i.count).join(', ') || 'NONE');
  console.log('Food items:', food.map(i => i.name + 'x' + i.count).join(', ') || 'none');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => { console.log('BOT DIED! Respawned.'); });
