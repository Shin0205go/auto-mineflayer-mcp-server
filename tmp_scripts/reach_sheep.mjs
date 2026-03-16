/**
 * Navigate to sheep at (-39, 114, -133) and shear for wool
 * Then test if mob loot is enabled by killing one sheep
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
  console.log('Starting pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Food:', bot.food, 'Time:', bot.time.timeOfDay);

  // Set up movements - allow 1x1 towers to climb hills
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = true;
  movements.maxDropDown = 3;
  bot.pathfinder.setMovements(movements);

  // Target sheep at (-39, 114, -133)
  const target = { x: -39, y: 114, z: -133 };
  console.log('Navigating to sheep at', target);

  bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 8));

  let arrived = false;
  bot.once('goal_reached', () => { arrived = true; });

  await sleep(30000);
  bot.pathfinder.setGoal(null);

  const pos = bot.entity.position;
  console.log('After nav, pos:', pos);
  console.log('HP:', bot.health, 'Food:', bot.food);

  // Find nearest sheep
  const entities = Object.values(bot.entities);
  const sheep = entities
    .filter(e => e && e.name && e.name.toLowerCase() === 'sheep')
    .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos));

  console.log('Sheep in view:', sheep.length);
  if (sheep.length > 0) {
    const closest = sheep[0];
    const dist = closest.position.distanceTo(pos);
    console.log('Closest sheep at', closest.position, 'dist:', dist.toFixed(1));

    if (dist < 5) {
      // Try to shear
      console.log('Attempting to use shears on sheep...');
      // Equip shears
      const shearsItem = bot.inventory.items().find(i => i.name === 'shears');
      if (shearsItem) {
        await bot.equip(shearsItem, 'hand');
        console.log('Equipped shears');

        try {
          await bot.activateEntity(closest);
          console.log('Used shears on sheep!');
          await sleep(1000);

          // Check inventory for wool
          const woolItems = bot.inventory.items().filter(i => i.name.includes('wool'));
          console.log('Wool in inventory:', woolItems.map(i => i.name + ' x' + i.count).join(', ') || 'none');
        } catch (e) {
          console.error('Shear error:', e.message);
        }
      } else {
        console.log('No shears in inventory!');
      }
    }
  }

  console.log('Final pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Food:', bot.food);

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
