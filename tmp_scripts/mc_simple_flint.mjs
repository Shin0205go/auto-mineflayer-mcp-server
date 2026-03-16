/**
 * Simple focused: get flint by mining gravel, get iron from y=108 ore
 * Very simple approach - no complex navigation loops
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear } = goals;
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function inv(name) { return bot.inventory.items().find(i => i.name === name); }
function invCount(name) { return inv(name)?.count || 0; }

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // === Mine gravel ===
  // Navigate to gravel patch and mine 20 blocks one by one
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 15000);
    bot.pathfinder.setGoal(new GoalNear(-9, 100, -20, 3));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
  });
  console.log('At gravel area:', bot.entity.position);

  let flintCount = invCount('flint');
  for (let i = 0; i < 25 && flintCount === 0; i++) {
    const gb = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 20 });
    if (!gb) { console.log('No gravel!'); break; }

    // Navigate to gravel
    await new Promise((resolve) => {
      const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 8000);
      bot.pathfinder.setGoal(new GoalNear(gb.position.x, gb.position.y, gb.position.z, 2));
      bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
      bot.once('path_update', r => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
    });

    // Mine it (no tool for better flint chance - same actually, flint rate is same regardless of tool)
    const pick = inv('iron_pickaxe');
    if (pick) await bot.equip(pick, 'hand');

    const closeGravel = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 3 });
    if (!closeGravel) continue;

    try {
      await Promise.race([
        bot.dig(closeGravel),
        sleep(5000)
      ]);
    } catch(e) {}

    await sleep(400);
    flintCount = invCount('flint');
    const gravelCount = invCount('gravel');
    if (i % 5 === 4 || flintCount > 0) {
      console.log(`Gravel mine ${i+1}: flint=${flintCount} gravel=${gravelCount}`);
    }
  }

  console.log('\nFlint:', invCount('flint'));

  // === Get iron ore ===
  // Iron ore at (-1, 108, -80) - navigate there
  console.log('\nGoing to iron ore...');
  await new Promise((resolve) => {
    const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 30000);
    bot.pathfinder.setGoal(new GoalNear(-1, 108, -80, 5));
    bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
    bot.once('path_update', r => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
  });
  console.log('At ore area:', bot.entity.position);

  // Find and mine iron ore
  const oreId = bot.registry.blocksByName['iron_ore']?.id;
  const oreId2 = bot.registry.blocksByName['deepslate_iron_ore']?.id;

  for (let i = 0; i < 5; i++) {
    const ore = bot.findBlock({ matching: b => b.id === oreId || b.id === oreId2, maxDistance: 15 });
    if (!ore) { console.log('No iron ore nearby'); break; }

    console.log('Mining', ore.name, 'at', ore.position);
    await new Promise((resolve) => {
      const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 10000);
      bot.pathfinder.setGoal(new GoalNear(ore.position.x, ore.position.y, ore.position.z, 2));
      bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
      bot.once('path_update', r => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
    });

    const closeOre = bot.findBlock({ matching: b => b.id === oreId || b.id === oreId2, maxDistance: 3 });
    if (!closeOre) continue;

    const pick2 = inv('diamond_pickaxe') || inv('iron_pickaxe');
    if (pick2) await bot.equip(pick2, 'hand');

    try {
      await Promise.race([bot.dig(closeOre), sleep(8000)]);
    } catch(e) {}
    await sleep(400);
  }

  const rawIron = invCount('raw_iron');
  console.log('Raw iron:', rawIron);

  // === Smelt ===
  if (rawIron > 0) {
    console.log('\nGoing to furnace at (-5, 101, -14)...');
    await new Promise((resolve) => {
      const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 30000);
      bot.pathfinder.setGoal(new GoalNear(-5, 101, -14, 3));
      bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
      bot.once('path_update', r => { if (r.status === 'noPath') { clearTimeout(to); resolve(); } });
    });

    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    console.log('Furnace:', furnaceBlock?.position || 'not found');

    if (furnaceBlock) {
      const fb = bot.blockAt(furnaceBlock.position);
      const furnace = await bot.openFurnace(fb);
      const coal = inv('coal');
      const ri = inv('raw_iron');
      if (coal) await furnace.putFuel(coal.type, null, 2);
      await sleep(200);
      if (ri) await furnace.putInput(ri.type, null, ri.count);
      await sleep(200);
      console.log('Smelting', ri?.count || 0, 'iron, waiting...');
      await sleep((ri?.count || 1) * 10500 + 3000);
      const out = furnace.outputItem();
      if (out) { await furnace.takeOutput(); console.log('Got', out.name, out.count); }
      furnace.close();
    }
  }

  // === Craft flint_and_steel ===
  const flint = inv('flint');
  const ironIngot = inv('iron_ingot');
  console.log('\nFlint:', flint?.count || 0, 'Iron:', ironIngot?.count || 0);

  if (flint && ironIngot) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      await bot.craft(recipes[0], 1, null);
      console.log('flint_and_steel crafted:', invCount('flint_and_steel') > 0 ? 'YES!' : 'no');
    }
  }

  console.log('\nFinal - HP:', bot.health, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel', 'leather'].forEach(n => {
    const c = invCount(n);
    if (c > 0) console.log(` ${n}x${c}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
