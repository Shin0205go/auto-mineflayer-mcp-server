/**
 * Navigate to cow at (-27, 103, -220) and test mob loot
 * Also try sheep at (-55, 107, -189)
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function logInventory() {
  const food = bot.inventory.items().filter(i =>
    ['beef', 'cooked_beef', 'mutton', 'cooked_mutton', 'porkchop', 'chicken', 'cooked_chicken',
     'rabbit', 'rotten_flesh', 'apple', 'bread', 'carrot', 'potato', 'cooked_porkchop'].includes(i.name)
  );
  const wool = bot.inventory.items().filter(i => i.name.includes('wool'));
  if (food.length > 0) console.log('Food:', food.map(i => i.name + 'x' + i.count).join(', '));
  if (wool.length > 0) console.log('Wool:', wool.map(i => i.name + 'x' + i.count).join(', '));
}

bot.once('spawn', async () => {
  await sleep(3000);
  console.log('Pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Food:', bot.food);

  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = true;
  movements.maxDropDown = 3;
  bot.pathfinder.setMovements(movements);

  // First try sheep at (-55, 107, -189) - lower than the cliff sheep
  const target = { x: -55, y: 107, z: -189 };
  console.log('Navigating to sheep group at', target);

  bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 10));
  await sleep(25000);
  bot.pathfinder.setGoal(null);

  const pos = bot.entity.position;
  console.log('After nav, pos:', pos, 'HP:', bot.health, 'Food:', bot.food);

  // Find sheep and shear
  const entities = Object.values(bot.entities);
  const sheepList = entities
    .filter(e => e && e.name && e.name.toLowerCase() === 'sheep')
    .sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos));

  console.log('Sheep visible:', sheepList.length);

  if (sheepList.length > 0) {
    const closest = sheepList[0];
    const dist = closest.position.distanceTo(pos);
    console.log('Closest sheep at', closest.position, 'dist:', dist.toFixed(1));

    // Navigate directly to this sheep
    bot.pathfinder.setGoal(new GoalNear(closest.position.x, closest.position.y, closest.position.z, 3));
    await sleep(15000);
    bot.pathfinder.setGoal(null);

    const newDist = closest.position.distanceTo(bot.entity.position);
    console.log('After moving to sheep, dist:', newDist.toFixed(1));

    if (newDist < 5) {
      // Shear
      const shearsItem = bot.inventory.items().find(i => i.name === 'shears');
      if (shearsItem) {
        await bot.equip(shearsItem, 'hand');
        console.log('Equipped shears, attempting to shear...');
        try {
          await bot.activateEntity(closest);
          console.log('Sheared sheep!');
          await sleep(500);
          logInventory();
        } catch (e) {
          console.error('Shear error:', e.message);
        }
      }

      // Also kill sheep to test mob loot
      console.log('Testing mob loot - killing sheep...');
      const sword = bot.inventory.items().find(i => i.name.includes('sword'));
      if (sword) await bot.equip(sword, 'hand');

      const itemsBefore = bot.inventory.items().length;
      bot.attack(closest);
      await sleep(3000);
      const itemsAfter = bot.inventory.items().length;
      console.log('Items before:', itemsBefore, 'after:', itemsAfter);
      logInventory();

      if (itemsAfter > itemsBefore) {
        console.log('SUCCESS: doMobLoot appears to be ENABLED now!');
      } else {
        console.log('WARNING: doMobLoot still appears disabled (no item drop from kill)');
      }
    }
  }

  console.log('Final pos:', bot.entity.position, 'HP:', bot.health, 'Food:', bot.food);
  logInventory();
  bot.quit();
});

bot.on('error', (err) => console.error('Bot error:', err.message));
bot.on('kicked', (reason) => console.log('Kicked:', reason));
