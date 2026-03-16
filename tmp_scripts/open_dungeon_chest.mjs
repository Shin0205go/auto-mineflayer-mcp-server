/**
 * Navigate to dungeon chests at (87, 35, -62) and (88, 35, -63)
 * Open them and collect useful items (especially book, leather, saddle)
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock } = goals;

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

  const chest1 = { x: 87, y: 35, z: -62 };
  const chest2 = { x: 88, y: 35, z: -63 };

  console.log('Navigating to dungeon chest at', chest1);
  bot.pathfinder.setGoal(new GoalNear(chest1.x, chest1.y, chest1.z, 3));

  let reached = false;
  bot.once('goal_reached', () => { reached = true; });

  await sleep(60000);  // Allow enough time to dig down
  bot.pathfinder.setGoal(null);

  const pos = bot.entity.position;
  console.log('After nav, pos:', pos, 'HP:', bot.health, 'Food:', bot.food);
  const dist = Math.sqrt(
    Math.pow(pos.x - chest1.x, 2) + Math.pow(pos.y - chest1.y, 2) + Math.pow(pos.z - chest1.z, 2)
  );
  console.log('Distance to chest1:', dist.toFixed(1));

  if (dist < 5) {
    console.log('Near chest! Opening...');
    const chestBlock = bot.blockAt({ x: chest1.x, y: chest1.y, z: chest1.z });
    console.log('Block at chest1:', chestBlock ? chestBlock.name : 'null');

    if (chestBlock && chestBlock.name === 'chest') {
      try {
        const chest = await bot.openContainer(chestBlock);
        console.log('Chest opened!');
        const items = chest.containerItems();
        console.log('Items in chest:', items.map(i => i.name + ' x' + i.count).join(', ') || 'empty');

        // Take valuable items
        const valuable = ['book', 'enchanted_book', 'saddle', 'name_tag', 'iron_ingot',
                         'golden_apple', 'bread', 'wheat', 'bucket', 'leather',
                         'music_disc_13', 'music_disc_cat'];
        for (const item of items) {
          if (valuable.some(v => item.name.includes(v))) {
            try {
              await bot.moveSlotItem(item.slot, -1);  // Move to inventory
              console.log('Took:', item.name, 'x' + item.count);
            } catch (e) {
              console.log('Failed to take', item.name, ':', e.message);
            }
          }
        }

        chest.close();
      } catch (e) {
        console.error('Failed to open chest:', e.message);
      }
    }
  } else {
    console.log('Too far from chest. Trying chest2...');
    bot.pathfinder.setGoal(new GoalNear(chest2.x, chest2.y, chest2.z, 3));
    await sleep(15000);
    bot.pathfinder.setGoal(null);

    const pos2 = bot.entity.position;
    const dist2 = Math.sqrt(
      Math.pow(pos2.x - chest2.x, 2) + Math.pow(pos2.y - chest2.y, 2) + Math.pow(pos2.z - chest2.z, 2)
    );
    console.log('Near chest2? dist:', dist2.toFixed(1), 'pos:', pos2);
  }

  // Report inventory
  const inv = bot.inventory.items();
  const books = inv.filter(i => i.name === 'book' || i.name === 'enchanted_book');
  const leather = inv.filter(i => i.name === 'leather');
  const saddles = inv.filter(i => i.name === 'saddle');
  const food = inv.filter(i => ['bread', 'wheat', 'apple', 'golden_apple'].includes(i.name));

  console.log('=== INVENTORY ===');
  console.log('Books:', books.map(i => i.name + 'x' + i.count).join(', ') || 'none');
  console.log('Leather:', leather.map(i => 'x' + i.count).join(', ') || 'none');
  console.log('Saddles:', saddles.length);
  console.log('Food:', food.map(i => i.name + 'x' + i.count).join(', ') || 'none');
  console.log('Total inv size:', inv.length);

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => console.log('BOT DIED! Respawning...'));
