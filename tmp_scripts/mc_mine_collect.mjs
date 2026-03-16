/**
 * Mine iron ore and WALK ONTO DROP to collect it
 * mineflayer requires bot to be physically on top of item to collect
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

async function goTo(x, y, z, dist = 1, t = 15000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

async function mineAndCollect(blockVec) {
  const block = bot.blockAt(blockVec);
  if (!block || !block.name.includes('ore')) {
    console.log('Block at', blockVec, ':', block?.name);
    return false;
  }
  console.log('Mining', block.name, 'at', blockVec);

  // Navigate adjacent
  await goTo(blockVec.x, blockVec.y, blockVec.z, 1, 10000);

  const currentBlock = bot.blockAt(blockVec);
  if (!currentBlock || !currentBlock.name.includes('ore')) {
    console.log('Block gone or changed:', currentBlock?.name);
    return false;
  }

  const pick = inv('diamond_pickaxe') || inv('iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');

  const rawBefore = invCount('raw_iron');

  // Mine and immediately walk to the drop spot
  await bot.dig(currentBlock);
  await sleep(200);

  // Walk directly onto where the block was
  await goTo(blockVec.x, blockVec.y, blockVec.z, 0, 5000);
  await sleep(500);

  // Also check for item entities nearby
  const dropItems = Object.values(bot.entities).filter(e =>
    e.type === 'object' && e.objectType === 'Item' &&
    e.position.distanceTo(blockVec) < 3
  );
  if (dropItems.length > 0) {
    console.log(`  ${dropItems.length} item entities near ore drop location`);
    // Navigate to closest drop
    const closest = dropItems.reduce((a, b) =>
      a.position.distanceTo(bot.entity.position) < b.position.distanceTo(bot.entity.position) ? a : b
    );
    await goTo(closest.position.x, closest.position.y, closest.position.z, 0, 5000);
    await sleep(500);
  }

  const rawAfter = invCount('raw_iron');
  console.log(`  raw_iron: ${rawBefore} -> ${rawAfter}`);
  return rawAfter > rawBefore;
}

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);
  console.log('Flint:', invCount('flint'), 'Raw iron:', invCount('raw_iron'), 'Iron ingot:', invCount('iron_ingot'));

  const movements = new Movements(bot);
  movements.maxDropDown = 3;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Navigate to ore area
  const r = await goTo(-8, 102, -80, 3, 30000);
  console.log('At ore area:', r, 'at', bot.entity.position);

  // Find and mine iron ore - walk onto each drop
  const oreId = bot.registry.blocksByName['iron_ore']?.id;
  const oreId2 = bot.registry.blocksByName['deepslate_iron_ore']?.id;

  for (let i = 0; i < 6; i++) {
    const ore = bot.findBlock({
      matching: b => b.id === oreId || b.id === oreId2,
      maxDistance: 10
    });
    if (!ore) { console.log('No more ore nearby'); break; }

    const mined = await mineAndCollect(ore.position.clone());
    if (mined) console.log('  Collected!');
    await sleep(300);
  }

  const rawIron = invCount('raw_iron');
  console.log('\nTotal raw iron:', rawIron);

  // If still no iron, check if items are on the ground
  const allDrops = Object.values(bot.entities).filter(e =>
    e.type === 'object' && e.objectType === 'Item' &&
    e.position.distanceTo(bot.entity.position) < 30
  );
  console.log('Item entities nearby:', allDrops.length);
  allDrops.forEach(e => {
    const dist = e.position.distanceTo(bot.entity.position);
    console.log(` dist=${dist.toFixed(1)} at ${Math.round(e.position.x)},${Math.round(e.position.y)},${Math.round(e.position.z)}`);
  });

  if (allDrops.length > 0) {
    // Walk to all drops
    for (const drop of allDrops) {
      await goTo(drop.position.x, drop.position.y, drop.position.z, 0, 5000);
      await sleep(300);
    }
    const rawAfterCollect = invCount('raw_iron');
    console.log('Raw iron after collecting drops:', rawAfterCollect);
  }

  const rawFinal = invCount('raw_iron');
  console.log('\nFinal raw iron:', rawFinal);

  // Smelt if we have iron
  if (rawFinal > 0) {
    console.log('\nGoing to furnace...');
    const r2 = await goTo(-5, 101, -14, 4, 40000);
    console.log('At furnace area:', r2, 'at', bot.entity.position);

    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    if (furnaceBlock) {
      await goTo(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 10000);
      const fb = bot.blockAt(furnaceBlock.position);
      try {
        const furnace = await bot.openFurnace(fb);
        const coal = inv('coal');
        const ri = inv('raw_iron');
        const n = Math.min(ri.count, 3);
        if (coal) await furnace.putFuel(coal.type, null, 2);
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, n);
        await sleep(200);
        console.log(`Smelting ${n} raw iron (${n * 10}s)...`);
        await sleep(n * 10500 + 2000);
        const out = furnace.outputItem();
        if (out) { await furnace.takeOutput(); console.log('Got', out.name, out.count); }
        furnace.close();
      } catch(e) { console.log('Furnace error:', e.message); }
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

  console.log('\n=== Final ===');
  console.log('HP:', bot.health, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].forEach(n => {
    const c = invCount(n);
    if (c > 0) console.log(` ${n}x${c}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
