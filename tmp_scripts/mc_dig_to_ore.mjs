/**
 * Dig through stone to reach iron ore, collect drop, smelt, craft flint_and_steel
 * HP=6 - need to be careful. No canDig=false (use it to dig to ore)
 * Ore at (1, 85-86, -108)
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalBlock } = goals;
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const inv = (name) => bot.inventory.items().find(i => i.name === name);
const invCount = (name) => inv(name)?.count || 0;

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  // Wait for HP to regenerate a bit if very low
  if (bot.health < 10) {
    console.log('HP low, waiting for regen...');
    await sleep(15000);
    console.log('HP now:', bot.health);
  }

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true; // Allow digging to reach ore
  bot.pathfinder.setMovements(movements);

  // Equip iron pickaxe for digging
  const pick = inv('iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');
  console.log('Tool:', bot.heldItem?.name);

  // Navigate to iron ore at (1, 86, -108) with canDig=true
  // This will dig through stone to get there
  const oreTarget = new Vec3(1, 86, -108);
  console.log('\n=== Navigating to iron ore (canDig=true) ===');

  const rawBefore = invCount('raw_iron');
  const invSlotsBefore = bot.inventory.items().length;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      bot.pathfinder.stop();
      resolve('timeout');
    }, 30000);

    // Listen for when bot collects items
    bot.on('playerCollect', (collector, item) => {
      if (collector.username === bot.username) {
        const raw = invCount('raw_iron');
        if (raw > rawBefore) {
          console.log('  [playerCollect] GOT RAW IRON!', raw);
        }
      }
    });

    bot.pathfinder.setGoal(new GoalNear(oreTarget.x, oreTarget.y, oreTarget.z, 1));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });

  console.log('After pathfinder nav: pos=', bot.entity.position, 'raw_iron=', invCount('raw_iron'));
  await sleep(500);

  // Now manually mine the ore if pathfinder didn't mine it
  const oreBlock = bot.blockAt(oreTarget);
  console.log('Ore block status:', oreBlock?.name);

  if (oreBlock && oreBlock.name.includes('ore')) {
    const dist = oreTarget.distanceTo(bot.entity.position);
    console.log('Ore still there, dist:', dist.toFixed(1), 'Mining manually...');

    bot.pathfinder.stop();
    await sleep(100);

    if (dist <= 4) {
      await bot.dig(oreBlock);
      await sleep(200);
      // Walk to drop
      await new Promise((resolve) => {
        const to = setTimeout(resolve, 3000);
        bot.pathfinder.setGoal(new GoalNear(oreTarget.x, oreTarget.y, oreTarget.z, 0));
        bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
        bot.once('path_update', () => { clearTimeout(to); resolve(); });
      });
      await sleep(500);
    }
  }

  const rawAfter = invCount('raw_iron');
  const invSlotsAfter = bot.inventory.items().length;
  console.log(`raw_iron: ${rawBefore} -> ${rawAfter} (inv: ${invSlotsBefore} -> ${invSlotsAfter})`);

  // Also mine nearby ores
  for (let i = 0; i < 4; i++) {
    const oreId = bot.registry.blocksByName['iron_ore']?.id;
    const nearOre = bot.findBlock({ matching: oreId, maxDistance: 5 });
    if (!nearOre) break;

    bot.pathfinder.stop();
    const dist = nearOre.position.distanceTo(bot.entity.position);
    if (dist <= 3) {
      console.log('Mining nearby ore at', nearOre.position, 'dist=', dist.toFixed(1));
      await bot.dig(nearOre);
      await sleep(200);
      await new Promise((resolve) => {
        const to = setTimeout(resolve, 2000);
        bot.pathfinder.setGoal(new GoalNear(nearOre.position.x, nearOre.position.y, nearOre.position.z, 0));
        bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
        bot.once('path_update', () => { clearTimeout(to); resolve(); });
      });
      await sleep(400);
    } else {
      // Navigate there with canDig=true
      await new Promise((resolve) => {
        const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 15000);
        bot.pathfinder.setGoal(new GoalNear(nearOre.position.x, nearOre.position.y, nearOre.position.z, 1));
        bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
        bot.once('path_update', r => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
      });
      bot.pathfinder.stop();
      const closeOre = bot.findBlock({ matching: oreId, maxDistance: 3 });
      if (closeOre) {
        await bot.dig(closeOre);
        await sleep(400);
      }
    }
    console.log('raw_iron now:', invCount('raw_iron'));
  }

  const rawIron = invCount('raw_iron');
  console.log('\nTotal raw iron:', rawIron);
  console.log('HP:', bot.health);

  // If still no iron, check if items on ground
  const drops = Object.values(bot.entities).filter(e =>
    e.type === 'object' && e.objectType === 'Item' &&
    e.position.distanceTo(bot.entity.position) < 20
  );
  console.log('Items on ground nearby:', drops.length);
  for (const d of drops) {
    console.log(` at ${Math.round(d.position.x)},${Math.round(d.position.y)},${Math.round(d.position.z)}`);
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 3000);
      bot.pathfinder.setGoal(new GoalNear(d.position.x, d.position.y, d.position.z, 0));
      bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
      bot.once('path_update', () => { clearTimeout(to); resolve(); });
    });
    await sleep(400);
  }
  console.log('raw_iron after collecting drops:', invCount('raw_iron'));

  const rawFinal = invCount('raw_iron');
  if (rawFinal > 0) {
    // Navigate to furnace and smelt
    console.log('\nGoing to furnace...');
    await new Promise((resolve) => {
      const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 40000);
      bot.pathfinder.setGoal(new GoalNear(-5, 101, -14, 4));
      bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
      bot.once('path_update', r => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
    });

    const fb = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    if (fb) {
      await new Promise((resolve) => {
        const to = setTimeout(resolve, 10000);
        bot.pathfinder.stop();
        bot.pathfinder.setGoal(new GoalNear(fb.position.x, fb.position.y, fb.position.z, 2));
        bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
        bot.once('path_update', () => { clearTimeout(to); resolve(); });
      });
      bot.pathfinder.stop();

      const fbBlock = bot.blockAt(fb.position);
      const furnace = await bot.openFurnace(fbBlock);
      const coal = inv('coal');
      const ri = inv('raw_iron');
      if (coal) await furnace.putFuel(coal.type, null, 2);
      await sleep(200);
      if (ri) await furnace.putInput(ri.type, null, ri.count);
      await sleep(200);
      console.log('Smelting', ri.count, 'iron...');
      await sleep(ri.count * 10500 + 2000);
      const out = furnace.outputItem();
      if (out) { await furnace.takeOutput(); console.log('Got:', out.name, out.count); }
      furnace.close();
    }
  }

  // Craft flint_and_steel
  const flint = invCount('flint');
  const iron = invCount('iron_ingot');
  console.log('\nFlint:', flint, 'Iron ingot:', iron);

  if (flint > 0 && iron > 0) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      await bot.craft(recipes[0], 1, null);
      console.log('flint_and_steel:', invCount('flint_and_steel') > 0 ? 'CRAFTED!' : 'failed');
    }
  }

  console.log('\n=== Final ===');
  console.log('HP:', bot.health, 'Hunger:', bot.food, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].forEach(n => {
    const c = invCount(n);
    if (c > 0) console.log(` ${n}x${c}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
