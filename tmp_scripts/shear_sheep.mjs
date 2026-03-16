/**
 * Now at (-22, 95, -133) - sheep at (-39, 114, -133)
 * Navigate north/west more, find accessible sheep, shear them
 * Also hunt for food
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ, GoalFollow } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getFood() {
  return bot.inventory.items().filter(i =>
    ['beef', 'cooked_beef', 'mutton', 'cooked_mutton', 'porkchop', 'cooked_porkchop',
     'chicken', 'cooked_chicken', 'rabbit', 'rotten_flesh', 'apple', 'bread', 'carrot',
     'potato', 'sweet_berries'].includes(i.name)
  );
}

function getWool() {
  return bot.inventory.items().filter(i => i.name.includes('wool'));
}

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Start:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);

  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = true;
  movements.maxDropDown = 3;
  bot.pathfinder.setMovements(movements);

  // Find all visible animals
  let entities = Object.values(bot.entities);
  let animals = entities.filter(e => e && e.name &&
    ['sheep', 'cow', 'pig', 'chicken', 'rabbit'].includes(e.name.toLowerCase())
  ).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));

  console.log('Animals visible:', animals.length);
  animals.slice(0, 5).forEach(a => {
    const dist = a.position.distanceTo(bot.entity.position);
    console.log(' -', a.name, 'at y=' + a.position.y.toFixed(0), 'dist:', dist.toFixed(1));
  });

  // Try to reach each animal, prefer ones at similar height
  for (const animal of animals.slice(0, 8)) {
    const dist = animal.position.distanceTo(bot.entity.position);
    const yDiff = Math.abs(animal.position.y - bot.entity.position.y);
    console.log('Trying', animal.name, 'at y=' + animal.position.y.toFixed(0), 'dist:', dist.toFixed(1), 'yDiff:', yDiff.toFixed(0));

    if (dist > 80) { console.log('Too far, skipping'); continue; }

    bot.pathfinder.setGoal(new GoalNear(animal.position.x, animal.position.y, animal.position.z, 3));

    let reached = false;
    bot.once('goal_reached', () => { reached = true; });

    const timeout = yDiff > 10 ? 20000 : 12000;
    await sleep(timeout);
    bot.pathfinder.setGoal(null);

    const dist2 = animal.position.distanceTo(bot.entity.position);
    console.log('After nav, dist to animal:', dist2.toFixed(1), 'HP:', bot.health);

    if (dist2 < 5) {
      console.log('Reached', animal.name + '!');

      // Shear if it's a sheep
      if (animal.name.toLowerCase() === 'sheep') {
        const shearsItem = bot.inventory.items().find(i => i.name === 'shears');
        if (shearsItem) {
          await bot.equip(shearsItem, 'hand');
          try {
            await bot.activateEntity(animal);
            console.log('Sheared sheep! Wool:', getWool().map(i => i.name + 'x' + i.count).join(', '));
            await sleep(300);
          } catch (e) {
            console.log('Shear failed:', e.message);
          }
        }
      }

      // Kill for food test
      const sword = bot.inventory.items().find(i => i.name.includes('sword'));
      if (sword) await bot.equip(sword, 'hand');

      const invBefore = bot.inventory.items().map(i => i.name + 'x' + i.count).join(',');
      console.log('Killing', animal.name, 'to test doMobLoot...');
      bot.attack(animal);
      await sleep(1500);

      const invAfter = bot.inventory.items().map(i => i.name + 'x' + i.count).join(',');
      if (invBefore !== invAfter) {
        console.log('SUCCESS: Got drops from', animal.name + '!');
      } else {
        console.log('No drops from', animal.name, '(doMobLoot still disabled?)');
      }

      const food = getFood();
      const wool = getWool();
      console.log('Food now:', food.length > 0 ? food.map(i => i.name + 'x' + i.count).join(', ') : 'none');
      console.log('Wool now:', wool.length > 0 ? wool.map(i => i.name + 'x' + i.count).join(', ') : 'none');

      if (food.length > 0 && wool.length >= 3) {
        console.log('Have food AND 3+ wool! Can make bed.');
        break;
      }
    } else {
      console.log('Could not reach', animal.name, '(dist still', dist2.toFixed(1), ')');
    }
  }

  console.log('Final pos:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  console.log('Final food:', getFood().map(i => i.name + 'x' + i.count).join(', ') || 'none');
  console.log('Final wool:', getWool().map(i => i.name + 'x' + i.count).join(', ') || 'none');

  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
