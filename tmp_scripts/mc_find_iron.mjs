/**
 * Search much wider area for iron ore
 * Currently at (-7, 102, -80)
 * Need iron_ingot x1 for flint_and_steel
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalXZ } = goals;
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const inv = (name) => bot.inventory.items().find(i => i.name === name);
const invCount = (name) => inv(name)?.count || 0;

async function goTo(x, z, t = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalXZ(x, z));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

async function goNear(x, y, z, dist = 2, t = 20000) {
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

  const movements = new Movements(bot);
  movements.maxDropDown = 3;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // First scan for iron ore in wide area
  const oreId = bot.registry.blocksByName['iron_ore']?.id;

  // Explore in different directions to find iron ore
  const basePos = bot.entity.position.clone();
  const explorations = [
    { x: 50, z: -80 },   // Further east from current
    { x: -50, z: -80 },  // Further west
    { x: 0, z: -120 },   // Further north
    { x: 50, z: 50 },    // Southeast
    { x: -50, z: 50 },   // Southwest
  ];

  let foundOre = null;

  for (const exp of explorations) {
    if (foundOre) break;
    const tx = basePos.x + exp.x;
    const tz = basePos.z + exp.z;

    console.log(`\nExploring (${Math.round(tx)}, z=${Math.round(tz)})...`);
    const r = await goTo(tx, tz, 25000);
    console.log(`Nav: ${r} at (${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.z)})`);

    await sleep(500);

    // Scan for iron ore
    const ores = bot.findBlocks({ matching: oreId, maxDistance: 50, count: 10 });
    console.log(`Iron ore within 50: ${ores.length}`);
    if (ores.length > 0) {
      ores.slice(0, 5).forEach(p => console.log(`  (${p.x},${p.y},${p.z})`));
      foundOre = ores[0];
    }
  }

  if (!foundOre) {
    console.log('\nNo iron ore found in exploration! Checking chests...');

    // Check all chests
    const chestId = bot.registry.blocksByName['chest']?.id;
    const chests = bot.findBlocks({ matching: chestId, maxDistance: 200, count: 20 });
    console.log('Chests within 200:', chests.length);

    for (const chestPos of chests) {
      const r = await goNear(chestPos.x, chestPos.y, chestPos.z, 2, 15000);
      if (r === 'noPath') continue;

      const chestBlock = bot.findBlock({ matching: chestId, maxDistance: 3 });
      if (!chestBlock) continue;

      try {
        const chest = await bot.openContainer(bot.blockAt(chestBlock.position));
        const items = chest.containerItems();
        const ironItems = items.filter(i =>
          ['iron_ingot', 'raw_iron', 'iron_ore', 'iron_nugget'].includes(i.name)
        );
        if (ironItems.length > 0) {
          console.log(`Chest at ${chestPos}: iron items found!`);
          ironItems.forEach(i => console.log(`  ${i.name}x${i.count}`));
          // Withdraw
          for (const item of ironItems) {
            await bot.moveSlotItem(item.slot, bot.inventory.firstEmptyInventorySlot());
            await sleep(200);
          }
          chest.close();
          break;
        }
        chest.close();
      } catch(e) { console.log(`Chest at ${chestPos} error:`, e.message); }
    }
  } else {
    // Mine the found ore
    console.log('\nMining ore at', foundOre);
    await goNear(foundOre.x, foundOre.y, foundOre.z, 2, 20000);

    const pick = inv('diamond_pickaxe') || inv('iron_pickaxe');
    if (pick) await bot.equip(pick, 'hand');

    for (let i = 0; i < 5; i++) {
      const ore = bot.findBlock({ matching: oreId, maxDistance: 4 });
      if (!ore) break;
      await goNear(ore.position.x, ore.position.y, ore.position.z, 1, 10000);
      const closeOre = bot.findBlock({ matching: oreId, maxDistance: 2 });
      if (!closeOre) continue;
      const rawBefore = invCount('raw_iron');
      await bot.dig(closeOre);
      await sleep(200);
      // Walk onto drop
      await goNear(closeOre.position.x, closeOre.position.y, closeOre.position.z, 0, 5000);
      await sleep(500);
      const rawAfter = invCount('raw_iron');
      console.log(`Ore mined: raw_iron ${rawBefore} -> ${rawAfter}`);
    }
  }

  const rawIron = invCount('raw_iron');
  const ironIngot = invCount('iron_ingot');
  console.log('\nRaw iron:', rawIron, '| Iron ingot:', ironIngot);

  // If we have raw iron, smelt it
  if (rawIron > 0 && ironIngot === 0) {
    console.log('Going to furnace...');
    await goNear(-5, 101, -14, 4, 40000);
    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    if (furnaceBlock) {
      await goNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 10000);
      const fb = bot.blockAt(furnaceBlock.position);
      try {
        const furnace = await bot.openFurnace(fb);
        const coal = inv('coal');
        const ri = inv('raw_iron');
        if (coal) await furnace.putFuel(coal.type, null, 2);
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, Math.min(ri.count, 3));
        await sleep(200);
        console.log(`Smelting ${Math.min(rawIron, 3)} iron...`);
        await sleep(Math.min(rawIron, 3) * 10500 + 2000);
        const out = furnace.outputItem();
        if (out) { await furnace.takeOutput(); console.log('Got:', out.name, out.count); }
        furnace.close();
      } catch(e) { console.log('Furnace:', e.message); }
    }
  }

  // Craft flint_and_steel
  const flint = invCount('flint');
  const finalIron = invCount('iron_ingot');
  console.log('\nFlint:', flint, 'Iron ingot:', finalIron);

  if (flint > 0 && finalIron > 0) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      await bot.craft(recipes[0], 1, null);
      console.log('flint_and_steel:', invCount('flint_and_steel') > 0 ? 'CRAFTED!' : 'FAILED');
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
