/**
 * Strategy: Get string from cobweb in mineshaft at (68, -10, -39)
 * Then craft fishing rod to catch fish for food + possibly enchanted book
 * Cobweb + shears = 9 string
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

  // Wait for daytime
  while (bot.time.timeOfDay > 12541) {
    console.log('Night, waiting... time:', bot.time.timeOfDay);
    await sleep(3000);
  }
  console.log('Day! time:', bot.time.timeOfDay);

  const mov = new Movements(bot);
  mov.canDig = true;
  mov.allow1by1towers = true;
  mov.maxDropDown = 3;
  bot.pathfinder.setMovements(mov);

  // Check for cobwebs (mineshaft at y=-10)
  const cobwebId = bot.registry.blocksByName['cobweb']?.id;
  const cobwebs = cobwebId ? bot.findBlocks({ matching: cobwebId, maxDistance: 64, count: 10 }) : [];
  console.log('Cobwebs in view:', cobwebs.length);

  if (cobwebs.length > 0) {
    console.log('Nearest cobweb at:', cobwebs[0]);
    const cw = cobwebs[0];

    // Navigate to cobweb
    bot.pathfinder.setGoal(new GoalNear(cw.x, cw.y, cw.z, 3));
    await sleep(30000);
    bot.pathfinder.setGoal(null);

    const dist = new Vec3(cw.x, cw.y, cw.z).distanceTo(bot.entity.position);
    console.log('Distance to cobweb:', dist.toFixed(1), 'pos:', bot.entity.position);

    if (dist < 5) {
      // Use shears to cut cobweb for string
      const shearsItem = bot.inventory.items().find(i => i.name === 'shears');
      if (shearsItem) {
        await bot.equip(shearsItem, 'hand');
        const cbBlock = bot.blockAt(cw);
        if (cbBlock) {
          console.log('Cutting cobweb with shears...');
          try {
            await bot.dig(cbBlock);
            console.log('Cut cobweb!');
          } catch(e) {
            console.log('Dig error:', e.message);
          }
          await sleep(500);
        }
      }
    }
  } else {
    console.log('No cobwebs in view. Need to explore mineshaft at y=-10...');
    // Try moving to mineshaft area
    bot.pathfinder.setGoal(new GoalNear(68, -10, -39, 5));
    await sleep(60000);
    bot.pathfinder.setGoal(null);
    console.log('After nav to mineshaft area:', bot.entity.position, 'HP:', bot.health);
  }

  // Check string in inventory
  const inv = bot.inventory.items();
  const strings = inv.filter(i => i.name === 'string');
  console.log('String in inventory:', strings.map(i => 'x' + i.count).join(', ') || 'none');

  if (strings.reduce((s, i) => s + i.count, 0) >= 2) {
    console.log('ENOUGH STRING for fishing rod! Crafting...');
    // stick x3 + string x2 = fishing rod
    // We have plenty of sticks
    try {
      const stick = bot.inventory.items().find(i => i.name === 'stick' && i.count >= 3);
      if (stick) {
        console.log('Have sticks and string - can craft fishing rod via mc_craft');
        await bot.chat('[報告] string確保! 釣り竿を作ります。fishing_rod craftします');
      }
    } catch(e) {
      console.log('Error:', e.message);
    }
  }

  console.log('HP:', bot.health, 'Food:', bot.food);
  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
bot.on('death', () => { console.log('BOT DIED!'); });
