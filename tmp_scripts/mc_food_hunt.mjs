/**
 * Food hunt: find nearest pig/sheep/cow within 200 blocks, navigate carefully, kill, eat
 * HP=9.5, Hunger=0 - starvation floor active. Must eat ASAP.
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  console.log('Spawned:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);

  await new Promise(r => setTimeout(r, 1500));

  // Scan for animals up to 200 blocks
  let animals = Object.values(bot.entities).filter(e =>
    ['pig', 'sheep', 'cow', 'chicken'].includes(e.name) &&
    e.position.distanceTo(bot.entity.position) < 200
  ).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));

  console.log('Animals found:', animals.length);
  animals.slice(0, 5).forEach(a => {
    const d = Math.round(a.position.distanceTo(bot.entity.position));
    console.log(` ${a.name} dist=${d} at ${Math.round(a.position.x)},${Math.round(a.position.y)},${Math.round(a.position.z)}`);
  });

  if (animals.length === 0) {
    console.log('No animals nearby. Checking sugar_cane/food options...');
    const sugarCane = bot.findBlock({ matching: bot.registry.blocksByName['sugar_cane']?.id, maxDistance: 64 });
    console.log('Sugar cane nearby:', sugarCane ? 'YES at ' + sugarCane.position : 'NO');
    console.log('HP:', bot.health, 'Hunger:', bot.food);
    const inv = bot.inventory.items();
    console.log('Inventory:', inv.map(i => `${i.name}x${i.count}`).join(', '));
    bot.end();
    return;
  }

  // Hunt nearest animal
  await huntAnimal(animals[0]);

  async function huntAnimal(target) {
    const dist = Math.round(target.position.distanceTo(bot.entity.position));
    console.log(`\nHunting ${target.name} at dist=${dist} pos=${Math.round(target.position.x)},${Math.round(target.position.y)},${Math.round(target.position.z)}`);

    try {
      // Navigate in stages for distant targets
      if (dist > 50) {
        const steps = Math.ceil(dist / 40);
        for (let s = 1; s <= steps; s++) {
          const frac = s / steps;
          const sx = bot.entity.position.x + (target.position.x - bot.entity.position.x) * frac;
          const sy = bot.entity.position.y;
          const sz = bot.entity.position.z + (target.position.z - bot.entity.position.z) * frac;
          console.log(`Stage ${s}/${steps}: ${Math.round(sx)},${Math.round(sy)},${Math.round(sz)}`);
          await new Promise((resolve) => {
            const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 20000);
            bot.pathfinder.setGoal(new GoalNear(sx, sy, sz, 3));
            bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
            bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
          });
          console.log('Current pos:', bot.entity.position, 'HP:', bot.health);
          if (bot.health < 3) {
            console.log('HP too low! Stopping navigation.');
            bot.pathfinder.stop();
            break;
          }
        }
      }

      // Final approach to target (refresh position)
      const tx = target.position.x, ty = target.position.y, tz = target.position.z;
      const distNow = Math.round(target.position.distanceTo(bot.entity.position));
      console.log('Near target, dist now:', distNow, 'HP:', bot.health);

      if (distNow > 8) {
        await new Promise((resolve) => {
          const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 15000);
          bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 2));
          bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
          bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
        });
      }

      const distFinal = Math.round(target.position.distanceTo(bot.entity.position));
      console.log('Final dist:', distFinal, 'HP:', bot.health);

      // Attack the animal
      if (distFinal < 8) {
        console.log('Attacking...');
        const sword = bot.inventory.items().find(i => i.name.includes('sword'));
        if (sword) await bot.equip(sword, 'hand');

        for (let i = 0; i < 10; i++) {
          if (!target.isValid || (target.metadata && target.metadata[8] === 0)) break;
          try { bot.attack(target); } catch(e) {}
          await new Promise(r => setTimeout(r, 500));
        }

        // Walk to drops
        await new Promise(r => setTimeout(r, 1500));
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 5000);
          bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1));
          bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
          bot.once('path_update', () => { clearTimeout(timeout); resolve(); });
        });
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log('Target too far after navigation, dist:', distFinal);
      }

      // Check inventory for food and leather
      const foodItems = bot.inventory.items().filter(i =>
        ['porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'mutton', 'cooked_mutton',
         'chicken', 'cooked_chicken', 'leather'].includes(i.name)
      );
      console.log('\nAfter kill - food/leather:');
      foodItems.forEach(f => console.log(` ${f.name} x${f.count}`));

      // Eat best available food
      const eatOrder = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'beef', 'porkchop', 'mutton', 'chicken'];
      for (const foodName of eatOrder) {
        const food = bot.inventory.items().find(i => i.name === foodName);
        if (food) {
          console.log('\nEating', foodName, 'x', food.count);
          await bot.equip(food, 'hand');
          // Eat multiple pieces if hungry
          for (let e = 0; e < Math.min(food.count, 3); e++) {
            bot.activateItem();
            await new Promise(r => setTimeout(r, 1800));
            if (bot.food >= 18) break;
          }
          console.log('After eating: HP', bot.health, 'Hunger', bot.food);
          break;
        }
      }

    } catch (e) {
      console.error('Error:', e.message);
    }

    console.log('\nFinal status:');
    console.log('Pos:', bot.entity.position);
    console.log('HP:', bot.health, 'Hunger:', bot.food);
    const inv = bot.inventory.items();
    console.log('Inventory:');
    inv.forEach(i => console.log(` ${i.name} x${i.count}`));

    bot.end();
  }
});

bot.on('error', e => { console.error('Bot error:', e.message); });
bot.on('end', () => { console.log('Bot disconnected'); process.exit(0); });
