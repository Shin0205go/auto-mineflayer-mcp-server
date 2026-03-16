/**
 * Safe approach to get iron:
 * 1. Navigate horizontally to nearby iron ore (if any visible)
 * 2. Mine gravel blocks safely (not above caves)
 * 3. Smelt at furnace at (-5, 101, -14)
 * 4. Craft flint_and_steel
 *
 * Respawned at (8.5, 120, 8.5) HP=20 after fall death
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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function goNear(x, y, z, dist = 2, t = 25000) {
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
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Check inventory
  const inv = bot.inventory.items();
  console.log('Key items:', inv.filter(i => ['diamond_pickaxe', 'iron_pickaxe', 'coal', 'flint', 'iron_ingot', 'raw_iron', 'gravel'].includes(i.name)).map(i => `${i.name}x${i.count}`).join(', '));

  // Step 1: Navigate to furnace at (-5, 101, -14) to confirm its location
  console.log('\n=== Going to furnace area ===');
  const result = await goNear(-5, 101, -14, 5, 30000);
  console.log('Result:', result, 'at', bot.entity.position);

  const furnaceBlock = bot.findBlock({
    matching: bot.registry.blocksByName['furnace']?.id,
    maxDistance: 20
  });
  console.log('Furnace at:', furnaceBlock?.position || 'NOT FOUND');

  // Step 2: Look for iron ore near y=80-100 area (we're at surface y=120)
  console.log('\n=== Looking for iron ore within 50 blocks ===');
  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    if (!id) continue;
    const found = bot.findBlocks({ matching: id, maxDistance: 50, count: 10 });
    if (found.length > 0) {
      console.log(oreName + ':', found.length, 'found');
      found.slice(0, 5).forEach(p => console.log(` (${p.x},${p.y},${p.z})`));
    }
  }

  // Step 3: Find gravel in visible area and mine it for flint
  console.log('\n=== Mining gravel for flint ===');
  let flint = bot.inventory.items().find(i => i.name === 'flint');

  if (!flint) {
    const gravelBlocks = bot.findBlocks({
      matching: bot.registry.blocksByName['gravel']?.id,
      maxDistance: 50,
      count: 30
    });
    console.log('Gravel blocks within 50:', gravelBlocks.length);

    let mined = 0;
    for (const gPos of gravelBlocks) {
      if (flint || mined >= 30) break;

      // Safety check: don't mine gravel if it could cause falls
      // Only mine gravel that's at surface level (y > 80) or on solid floor
      if (gPos.y < 80) {
        // Check if there's solid ground below
        const below = bot.blockAt(new Vec3(gPos.x, gPos.y - 1, gPos.z));
        if (!below || below.name === 'air') continue; // skip - cave gravel
      }

      await goNear(gPos.x, gPos.y, gPos.z, 3, 10000);

      const gb = bot.findBlock({
        matching: bot.registry.blocksByName['gravel']?.id,
        maxDistance: 4
      });
      if (!gb) continue;

      // Check below the gravel to ensure it's safe to mine
      const below = bot.blockAt(new Vec3(gb.position.x, gb.position.y - 1, gb.position.z));
      if (!below || below.name === 'air') {
        console.log('Skipping cave-top gravel at', gb.position);
        continue;
      }

      const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe');
      if (pick) await bot.equip(pick, 'hand');

      try {
        await bot.dig(gb);
        await sleep(500);
        mined++;
        flint = bot.inventory.items().find(i => i.name === 'flint');
        if (mined % 5 === 0 || flint) {
          console.log('Mined gravel', mined, '| flint:', flint?.count || 0);
        }
      } catch(e) {
        console.log('Dig error:', e.message);
      }
    }
  }

  flint = bot.inventory.items().find(i => i.name === 'flint');
  console.log('Flint result:', flint?.count || 0);

  // Step 4: Find and mine iron ore
  let rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');

  if (!rawIron) {
    console.log('\n=== Mining iron ore ===');

    // Look for iron ore in a mountain/cliff area (y=40-80)
    for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
      const id = bot.registry.blocksByName[oreName]?.id;
      if (!id) continue;

      // Use pathfinder to navigate - find ore visible from surface
      const oreBlocks = bot.findBlocks({ matching: id, maxDistance: 80, count: 10 });
      if (oreBlocks.length > 0) {
        console.log(`Found ${oreBlocks.length} ${oreName} blocks`);
        // Sort by Y (prefer higher ones = safer to reach)
        oreBlocks.sort((a, b) => b.y - a.y);
        oreBlocks.slice(0, 3).forEach(p => console.log(` (${p.x},${p.y},${p.z})`));

        for (const orePos of oreBlocks) {
          const result2 = await goNear(orePos.x, orePos.y, orePos.z, 3, 20000);
          if (result2 === 'noPath') continue;

          const closeOre = bot.findBlock({ matching: id, maxDistance: 4 });
          if (!closeOre) continue;

          const pick2 = bot.inventory.items().find(i => i.name === 'iron_pickaxe' || i.name === 'diamond_pickaxe');
          if (pick2) await bot.equip(pick2, 'hand');

          try {
            await bot.dig(closeOre);
            await sleep(300);
            rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
            if (rawIron) {
              console.log('Got raw_iron x', rawIron.count);
              // Mine a few more while here
              for (let extra = 0; extra < 4; extra++) {
                const more = bot.findBlock({ matching: id, maxDistance: 5 });
                if (!more) break;
                await bot.dig(more);
                await sleep(200);
              }
              rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
              console.log('Total raw_iron:', rawIron.count);
              break;
            }
          } catch(e) { console.log('Mine error:', e.message); }
        }
        if (rawIron) break;
      }
    }
  }

  console.log('\nRaw iron:', rawIron?.count || 0);

  // Step 5: Smelt
  let ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  if (!ironIngot && rawIron) {
    console.log('\n=== Smelting at furnace ===');

    let fb = bot.findBlock({
      matching: bot.registry.blocksByName['furnace']?.id,
      maxDistance: 100
    });

    if (!fb) {
      // Go back to base and find furnace
      await goNear(-5, 101, -14, 3, 30000);
      fb = bot.findBlock({
        matching: bot.registry.blocksByName['furnace']?.id,
        maxDistance: 10
      });
    }

    if (fb) {
      await goNear(fb.position.x, fb.position.y, fb.position.z, 2, 20000);
      const fbBlock = bot.blockAt(fb.position);
      try {
        const furnace = await bot.openFurnace(fbBlock);
        const coal = bot.inventory.items().find(i => i.name === 'coal');
        const ri = bot.inventory.items().find(i => i.name === 'raw_iron');
        const count = Math.min(ri.count, 5);
        if (coal) await furnace.putFuel(coal.type, null, Math.min(coal.count, count + 1));
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, count);
        await sleep(200);
        console.log(`Smelting ${count} iron, waiting ${count * 10}s...`);
        await sleep(count * 10500 + 2000);
        const out = furnace.outputItem();
        console.log('Output:', out?.name, out?.count);
        if (out) await furnace.takeOutput();
        furnace.close();
        await sleep(300);
      } catch(e) { console.log('Furnace error:', e.message); }
    } else {
      console.log('No furnace found!');
    }
  }

  // Step 6: Craft flint_and_steel
  flint = bot.inventory.items().find(i => i.name === 'flint');
  ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  console.log('\nFlint:', flint?.count || 0, 'Iron ingot:', ironIngot?.count || 0);

  if (flint && ironIngot) {
    console.log('=== Crafting flint_and_steel ===');
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        const fas = bot.inventory.items().find(i => i.name === 'flint_and_steel');
        console.log('Result: flint_and_steel =', fas ? 'CRAFTED!' : 'FAILED');
      } catch(e) { console.log('Craft error:', e.message); }
    }
  }

  console.log('\n=== Final ===');
  console.log('HP:', bot.health, 'at', bot.entity.position);
  bot.inventory.items().filter(i =>
    ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].includes(i.name)
  ).forEach(i => console.log(` ${i.name}x${i.count}`));

  bot.end();
});

bot.on('error', e => { console.error('Error:', e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
