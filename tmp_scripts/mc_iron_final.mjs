/**
 * Final iron ore mining:
 * 1. Navigate to ore (pathfinder stops before dig)
 * 2. Stop pathfinder
 * 3. Mine block
 * 4. Walk to drop location
 * 5. Smelt, craft flint_and_steel
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
const inv = (name) => bot.inventory.items().find(i => i.name === name);
const invCount = (name) => inv(name)?.count || 0;

async function navTo(x, y, z, dist = 1, t = 20000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);
  console.log('Inv slots used:', bot.inventory.items().length, '/ 36');
  console.log('Flint:', invCount('flint'), 'Raw iron:', invCount('raw_iron'));

  const movements = new Movements(bot);
  movements.maxDropDown = 3;
  movements.canDig = false; // Never let pathfinder auto-dig
  bot.pathfinder.setMovements(movements);

  // Navigate to ore area
  const orePositions = [
    new Vec3(1, 86, -108),
    new Vec3(1, 85, -107),
    new Vec3(1, 85, -108),
    new Vec3(0, 85, -107),
    new Vec3(0, 85, -108),
  ];

  let gotIron = false;

  for (const orePos of orePositions) {
    if (gotIron) break;

    // Navigate to adjacent position (dist=1)
    console.log(`\nGoing to ore at (${orePos.x},${orePos.y},${orePos.z})...`);
    const r = await navTo(orePos.x, orePos.y, orePos.z, 1, 20000);
    console.log(`Nav: ${r} at ${bot.entity.position}`);

    const dist = orePos.distanceTo(bot.entity.position);
    console.log(`Distance to ore: ${dist.toFixed(1)}`);

    if (dist > 4) {
      console.log('Too far, skipping');
      continue;
    }

    // Stop pathfinder BEFORE digging
    bot.pathfinder.stop();
    await sleep(100);

    const oreBlock = bot.blockAt(orePos);
    if (!oreBlock || !oreBlock.name.includes('ore')) {
      console.log('Ore gone:', oreBlock?.name);
      continue;
    }

    console.log(`Mining ${oreBlock.name} with dist=${dist.toFixed(1)}`);

    // Equip pickaxe
    const pick = inv('diamond_pickaxe') || inv('iron_pickaxe');
    if (pick) await bot.equip(pick, 'hand');

    const rawBefore = invCount('raw_iron');
    const invSlotsBefore = bot.inventory.items().length;

    // Dig
    try {
      await bot.dig(oreBlock);
    } catch(e) {
      console.log('Dig error:', e.message);
    }

    await sleep(300);
    console.log(`After dig: raw_iron=${invCount('raw_iron')}, slots=${bot.inventory.items().length}`);

    // Walk to exact ore position to collect drop
    // The drop spawns at the block's position (center of block = x+0.5, y, z+0.5)
    const dropX = orePos.x + 0.5;
    const dropZ = orePos.z + 0.5;

    // Move toward the drop
    bot.entity.position.set(dropX, bot.entity.position.y, dropZ); // Teleport in local sim? No...

    // Use pathfinder to walk there
    const r2 = await navTo(orePos.x, orePos.y, orePos.z, 0, 5000);
    await sleep(500);

    const rawAfter = invCount('raw_iron');
    console.log(`After collect attempt: raw_iron=${rawAfter} (slots=${bot.inventory.items().length})`);

    // Check item entities nearby
    const drops = Object.values(bot.entities).filter(e =>
      e.type === 'object' && e.objectType === 'Item' &&
      e.position.distanceTo(orePos) < 5
    );
    console.log('Items on ground near ore:', drops.length);
    if (drops.length > 0) {
      for (const d of drops) {
        console.log(` item at ${d.position} dist_from_bot=${d.position.distanceTo(bot.entity.position).toFixed(1)}`);
        const r3 = await navTo(d.position.x, d.position.y, d.position.z, 0, 5000);
        await sleep(500);
        console.log(` After walking to item: raw_iron=${invCount('raw_iron')}`);
      }
    }

    if (invCount('raw_iron') > 0) {
      gotIron = true;
      console.log('GOT RAW IRON!');
    }
  }

  const rawIron = invCount('raw_iron');
  console.log('\nTotal raw iron:', rawIron);

  if (rawIron > 0) {
    // Smelt
    console.log('\nGoing to furnace...');
    const r = await navTo(-5, 101, -14, 4, 40000);
    console.log('At furnace area:', r, 'at', bot.entity.position);

    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    if (furnaceBlock) {
      const r2 = await navTo(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 10000);
      const fb = bot.blockAt(furnaceBlock.position);
      try {
        const furnace = await bot.openFurnace(fb);
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
      } catch(e) { console.log('Furnace:', e.message); }
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
      try {
        await bot.craft(recipes[0], 1, null);
        console.log('flint_and_steel:', invCount('flint_and_steel') > 0 ? 'CRAFTED!' : 'failed');
      } catch(e) { console.log('Craft error:', e.message); }
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
