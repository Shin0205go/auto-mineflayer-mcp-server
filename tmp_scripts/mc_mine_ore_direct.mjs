/**
 * Direct iron ore mining at (-8, 101-103, -80)
 * We have flint=1, need iron_ingot=1 for flint_and_steel
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

async function goTo(x, y, z, dist = 3, t = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);
  console.log('Flint:', invCount('flint'), 'Iron:', invCount('iron_ingot'), 'Raw iron:', invCount('raw_iron'));

  const movements = new Movements(bot);
  movements.maxDropDown = 3;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Go to ore area
  const r = await goTo(-8, 102, -80, 4, 30000);
  console.log('At ore area:', r, 'pos:', bot.entity.position);

  // List what's around us
  console.log('\nBlocks near ore area:');
  for (const name of ['iron_ore', 'deepslate_iron_ore', 'stone', 'cobblestone', 'air']) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) continue;
    const found = bot.findBlocks({ matching: id, maxDistance: 5, count: 5 });
    if (found.length > 0) console.log(` ${name}: ${found.length} blocks`);
  }

  // Try mining directly at known ore positions
  const orePositions = [
    new Vec3(-8, 103, -80),
    new Vec3(-8, 102, -80),
    new Vec3(-7, 103, -80),
    new Vec3(-7, 102, -80),
    new Vec3(-8, 101, -80),
    new Vec3(-8, 102, -81),
    new Vec3(-8, 103, -81),
    new Vec3(-7, 103, -81),
  ];

  const pick = inv('diamond_pickaxe') || inv('iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');

  for (const pos of orePositions) {
    const block = bot.blockAt(pos);
    console.log(`Block at ${pos.x},${pos.y},${pos.z}: ${block?.name || 'unknown'}`);

    if (block && (block.name === 'iron_ore' || block.name === 'deepslate_iron_ore')) {
      const dist = pos.distanceTo(bot.entity.position);
      console.log(` -> Distance: ${dist.toFixed(1)}`);

      // Navigate close to it using GoalBlock (exact block position)
      await new Promise((resolve) => {
        const to = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 12000);
        // Use GoalNear with distance 1 for adjacent
        bot.pathfinder.setGoal(new GoalNear(pos.x, pos.y, pos.z, 1));
        bot.once('goal_reached', () => { clearTimeout(to); resolve(); });
        bot.once('path_update', (p) => { if (p.status === 'noPath') { clearTimeout(to); resolve(); } });
      });

      const finalDist = pos.distanceTo(bot.entity.position);
      console.log(`  After nav dist: ${finalDist.toFixed(1)}, at ${bot.entity.position}`);

      if (finalDist < 5) {
        // Try digging
        const currentBlock = bot.blockAt(pos);
        if (currentBlock && currentBlock.name.includes('iron_ore')) {
          console.log(`  Mining ${currentBlock.name}...`);
          const rawBefore = invCount('raw_iron');
          try {
            await bot.dig(currentBlock);
            await sleep(400);
            const rawAfter = invCount('raw_iron');
            console.log(`  raw_iron: ${rawBefore} -> ${rawAfter}`);
            if (rawAfter > rawBefore) {
              console.log('GOT RAW IRON!');
            }
          } catch(e) { console.log('  Dig error:', e.message); }
        } else {
          console.log(`  Block changed to: ${currentBlock?.name}`);
        }
      }
    }
  }

  const rawIron = invCount('raw_iron');
  console.log('\nRaw iron total:', rawIron);

  if (rawIron > 0) {
    // Smelt
    console.log('\nGoing to furnace...');
    const r2 = await goTo(-5, 101, -14, 3, 40000);
    console.log('Furnace area:', r2, 'at', bot.entity.position);

    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    if (furnaceBlock) {
      const r3 = await goTo(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 15000);
      const fb = bot.blockAt(furnaceBlock.position);
      try {
        const furnace = await bot.openFurnace(fb);
        const coal = inv('coal');
        const ri = inv('raw_iron');
        if (coal) await furnace.putFuel(coal.type, null, 2);
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, Math.min(ri.count, 3));
        await sleep(200);
        const n = Math.min(rawIron, 3);
        console.log(`Smelting ${n} iron (${n * 10}s)...`);
        await sleep(n * 10500 + 2000);
        const out = furnace.outputItem();
        if (out) { await furnace.takeOutput(); console.log('Got', out.name, out.count); }
        furnace.close();
      } catch(e) { console.log('Furnace:', e.message); }
    }
  }

  // Craft flint_and_steel
  const flint = invCount('flint');
  const ironIngot = invCount('iron_ingot');
  console.log('\nFlint:', flint, 'Iron ingot:', ironIngot);

  if (flint > 0 && ironIngot > 0) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      await bot.craft(recipes[0], 1, null);
      console.log('flint_and_steel:', invCount('flint_and_steel') > 0 ? 'CRAFTED!' : 'failed');
    }
  }

  console.log('\nFinal - HP:', bot.health, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].forEach(n => {
    const c = invCount(n);
    if (c > 0) console.log(` ${n}x${c}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
