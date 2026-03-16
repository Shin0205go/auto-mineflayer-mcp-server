/**
 * Find food: check base chests, search for animals further away, find sugar cane
 * Then craft book if leather found, then craft enchanting table
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ } = goals;

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

bot.once('spawn', async () => {
  console.log('Spawned at:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);

  await sleep(1000);

  // Step 1: Check all nearby chests for food
  console.log('\n=== Checking chests for food ===');
  const chestBlocks = bot.findBlocks({
    matching: bot.registry.blocksByName['chest']?.id,
    maxDistance: 30,
    count: 10
  });
  console.log('Chests nearby:', chestBlocks.length);

  for (const chestPos of chestBlocks) {
    try {
      const chestBlock = bot.blockAt(chestPos);
      // Navigate near chest
      await new Promise((resolve) => {
        const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 8000);
        bot.pathfinder.setGoal(new GoalNear(chestPos.x, chestPos.y, chestPos.z, 2));
        bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
        bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
      });

      const chest = await bot.openContainer(chestBlock);
      const items = chest.containerItems();
      const food = items.filter(i => ['porkchop', 'cooked_porkchop', 'beef', 'cooked_beef',
        'mutton', 'cooked_mutton', 'chicken', 'cooked_chicken', 'bread', 'carrot',
        'potato', 'baked_potato', 'apple', 'leather'].includes(i.name));
      if (food.length > 0) {
        console.log(`Chest at ${chestPos}: food/leather found:`);
        food.forEach(f => console.log(`  ${f.name} x${f.count}`));

        // Withdraw food items
        for (const f of food) {
          await bot.moveSlotItem(f.slot, bot.inventory.firstEmptyInventorySlot());
          await sleep(200);
        }
      } else {
        const allItems = items.map(i => `${i.name}x${i.count}`).join(', ');
        console.log(`Chest at ${chestPos}: ${allItems || '(empty)'}`);
      }
      chest.close();
    } catch(e) {
      console.log(`Chest at ${chestPos} error:`, e.message);
    }
  }

  // Check inventory after chest search
  const foodInInv = bot.inventory.items().filter(i =>
    ['porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'mutton', 'cooked_mutton',
     'chicken', 'cooked_chicken', 'bread', 'carrot', 'baked_potato', 'apple'].includes(i.name)
  );
  console.log('\nFood in inventory:', foodInInv.map(i => `${i.name}x${i.count}`).join(', ') || 'NONE');

  // Step 2: Explore in 4 directions to find animals
  console.log('\n=== Exploring for animals ===');
  const basePos = bot.entity.position.clone();
  const directions = [
    { name: 'North', x: 0, z: -80 },
    { name: 'South', x: 0, z: 80 },
    { name: 'East', x: 80, z: 0 },
    { name: 'West', x: -80, z: 0 },
  ];

  for (const dir of directions) {
    const targetX = basePos.x + dir.x;
    const targetZ = basePos.z + dir.z;
    console.log(`\nExploring ${dir.name}: ${Math.round(targetX)},y,${Math.round(targetZ)}`);

    await new Promise((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 20000);
      bot.pathfinder.setGoal(new GoalXZ(targetX, targetZ));
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
      bot.once('path_update', (r) => {
        if (r.status === 'noPath') { clearTimeout(timeout); resolve(); }
      });
    });

    // Check for animals after moving
    await sleep(1000);
    const nearAnimals = Object.values(bot.entities).filter(e =>
      ['pig', 'sheep', 'cow', 'chicken'].includes(e.name) &&
      e.position.distanceTo(bot.entity.position) < 50
    );
    console.log(`  At ${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.z)}: found ${nearAnimals.length} animals`);
    nearAnimals.forEach(a => {
      const d = Math.round(a.position.distanceTo(bot.entity.position));
      console.log(`    ${a.name} dist=${d} at ${Math.round(a.position.x)},${Math.round(a.position.y)},${Math.round(a.position.z)}`);
    });

    if (nearAnimals.length > 0) {
      console.log('Found animals! Hunting...');
      const target = nearAnimals.find(a => a.name === 'cow') || nearAnimals[0];
      await huntAndCollect(target);

      // Check if we have food now
      const foodNow = bot.inventory.items().filter(i =>
        ['porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'mutton', 'cooked_mutton',
         'chicken', 'cooked_chicken'].includes(i.name)
      );
      if (foodNow.length > 0) {
        console.log('Got food! Eating...');
        const bestFood = foodNow.find(i => i.name.startsWith('cooked_')) || foodNow[0];
        await bot.equip(bestFood, 'hand');
        for (let e = 0; e < Math.min(bestFood.count, 5); e++) {
          bot.activateItem();
          await sleep(1800);
          if (bot.food >= 18) break;
        }
        console.log('After eating: HP', bot.health, 'Hunger', bot.food);
      }

      const leather = bot.inventory.items().find(i => i.name === 'leather');
      if (leather) {
        console.log('Got leather! Heading back to base to craft book + enchanting table');
        break;
      }

      // Hunt more animals for leather if we got pigs/sheep
      console.log('No leather yet, continuing search...');
    }
  }

  // Final status
  console.log('\n=== Final Status ===');
  console.log('Pos:', bot.entity.position);
  console.log('HP:', bot.health, 'Hunger:', bot.food);
  const inv = bot.inventory.items();
  const leatherCount = inv.find(i => i.name === 'leather')?.count || 0;
  console.log('Leather:', leatherCount);
  console.log('Inventory:', inv.map(i => `${i.name}x${i.count}`).join(', '));

  bot.end();

  async function huntAndCollect(target) {
    const tx = target.position.x, ty = target.position.y, tz = target.position.z;
    console.log(`  Hunting ${target.name} at ${Math.round(tx)},${Math.round(ty)},${Math.round(tz)}`);

    await new Promise((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 12000);
      bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 2));
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
      bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
    });

    const distFinal = target.position.distanceTo(bot.entity.position);
    console.log('  Distance to target:', Math.round(distFinal));

    if (distFinal < 5) {
      const sword = bot.inventory.items().find(i => i.name.includes('sword'));
      if (sword) await bot.equip(sword, 'hand');

      for (let i = 0; i < 10; i++) {
        if (!target.isValid) break;
        try { bot.attack(target); } catch(e) {}
        await sleep(500);
      }
      await sleep(1500);

      // Walk to pickup drops
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 4000);
        bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1));
        bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
        bot.once('path_update', () => { clearTimeout(timeout); resolve(); });
      });
      await sleep(1000);
    }
  }
});

bot.on('error', e => { console.error('Bot error:', e.message); });
bot.on('end', () => { console.log('Bot disconnected'); process.exit(0); });
