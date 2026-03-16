/**
 * Dig straight down from y=58 to y=40 to find iron ore and gravel
 * Then smelt iron and craft flint_and_steel
 */
import mineflayer from 'mineflayer';
import pfPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pfPkg;
const { GoalNear, GoalY } = goals;
import { Vec3 } from 'vec3';

const bot = mineflayer.createBot({
  host: 'localhost', port: 25565, username: 'Claude1', version: '1.21.4'
});
bot.loadPlugin(pathfinder);

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function goNear(x, y, z, dist = 2, t = 20000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

async function digBlockAt(vec3pos) {
  const block = bot.blockAt(vec3pos);
  if (!block || block.name === 'air' || block.name === 'water' || block.name === 'lava') return block?.name || 'air';
  try {
    await bot.dig(block);
    await sleep(150);
    return block.name;
  } catch(e) {
    return 'error: ' + e.message;
  }
}

bot.once('spawn', async () => {
  await sleep(1500);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Equip diamond pickaxe for fast mining
  const pick = bot.inventory.items().find(i => i.name === 'diamond_pickaxe') ||
               bot.inventory.items().find(i => i.name === 'iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');
  console.log('Tool:', bot.heldItem?.name);

  let foundIronOre = null;
  let foundGravel = false;

  // Scan what's visible around us first
  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    if (!id) continue;
    const found = bot.findBlocks({ matching: id, maxDistance: 30, count: 10 });
    if (found.length > 0) {
      console.log(oreName, 'visible:', found.length, 'at', found[0]);
      foundIronOre = found[0];
      break;
    }
  }

  // Dig down if no iron ore visible
  if (!foundIronOre) {
    console.log('\n=== Digging down to find iron ore ===');
    const x = Math.round(bot.entity.position.x);
    const z = Math.round(bot.entity.position.z);
    let y = Math.round(bot.entity.position.y) - 1;
    let blocksDug = 0;

    while (y > 35 && !foundIronOre) {
      // Check current area for iron ore
      for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
        const id = bot.registry.blocksByName[oreName]?.id;
        if (!id) continue;
        const found = bot.findBlock({ matching: id, maxDistance: 8 });
        if (found) {
          console.log('Found', oreName, 'at y=', found.position.y);
          foundIronOre = found.position;
          break;
        }
      }
      if (foundIronOre) break;

      // Dig the block below bot
      const below = new Vec3(x, y, z);
      const belowBlock = bot.blockAt(below);
      const name = belowBlock?.name;

      if (name === 'lava') {
        console.log('Lava at y=', y, '! Stopping.');
        break;
      }
      if (name === 'water') {
        console.log('Water at y=', y, ', skipping');
        y--;
        continue;
      }

      // Also check if it's gravel (flint!)
      if (name === 'gravel' && !foundGravel) {
        console.log('Gravel at y=', y);
      }

      // Dig
      if (name && name !== 'air') {
        const result = await digBlockAt(below);
        blocksDug++;

        // Check if we got gravel drop (flint)
        const flintCheck = bot.inventory.items().find(i => i.name === 'flint');
        if (flintCheck && !foundGravel) {
          foundGravel = true;
          console.log('GOT FLINT from gravel at y=', y);
        }

        if (blocksDug % 5 === 0) {
          console.log('y=', y, 'block=', name, 'HP:', bot.health);
        }
      }

      // Move down
      const currentY = bot.entity.position.y;
      if (currentY > y + 0.5) {
        // Bot might have fallen to the dug space
      }
      y--;

      if (bot.health < 8) {
        console.log('HP low! Stopping at y=', y);
        break;
      }
    }
  }

  // Mine iron ore
  if (foundIronOre) {
    console.log('\n=== Mining iron ore at', foundIronOre, '===');
    const rawBefore = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;

    await goNear(foundIronOre.x, foundIronOre.y, foundIronOre.z, 2, 15000);
    const oreName = ['iron_ore', 'deepslate_iron_ore'];
    for (const name of oreName) {
      const id = bot.registry.blocksByName[name]?.id;
      const found = bot.findBlock({ matching: id, maxDistance: 4 });
      if (found) {
        await bot.dig(found);
        await sleep(500);
        const rawAfter = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;
        console.log('Raw iron:', rawBefore, '->', rawAfter);
        break;
      }
    }

    // Mine multiple if available
    for (let extra = 0; extra < 5; extra++) {
      let found2 = null;
      for (const name of oreName) {
        const id = bot.registry.blocksByName[name]?.id;
        found2 = bot.findBlock({ matching: id, maxDistance: 10 });
        if (found2) break;
      }
      if (!found2) break;
      await goNear(found2.position.x, found2.position.y, found2.position.z, 2, 10000);
      const f = bot.findBlock({ matching: b => b.name.includes('iron_ore'), maxDistance: 4 });
      if (f) {
        await bot.dig(f);
        await sleep(300);
      }
    }
  }

  // Smelt raw_iron
  let rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
  console.log('\nRaw iron:', rawIron ? rawIron.count : 0);

  if (rawIron) {
    // Navigate back up to furnace
    console.log('Going to furnace...');
    const furnaceBlock = bot.findBlock({
      matching: bot.registry.blocksByName['furnace']?.id,
      maxDistance: 100
    });

    if (furnaceBlock) {
      console.log('Furnace at:', furnaceBlock.position);
      await goNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 40000);
      const fb = bot.blockAt(furnaceBlock.position);

      try {
        const furnace = await bot.openFurnace(fb);
        const coal = bot.inventory.items().find(i => i.name === 'coal');
        const ri = bot.inventory.items().find(i => i.name === 'raw_iron');
        console.log('Adding fuel:', coal?.name, 'and input:', ri?.name);
        if (coal) await furnace.putFuel(coal.type, null, Math.min(coal.count, 5));
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, ri.count);
        await sleep(200);
        console.log('Smelting... waiting', ri.count * 10, 'seconds');
        await sleep(ri.count * 10500 + 2000);
        const out = furnace.outputItem();
        console.log('Output:', out?.name, out?.count);
        if (out) {
          await furnace.takeOutput();
          await sleep(300);
        }
        furnace.close();
      } catch(e) { console.log('Furnace error:', e.message); }
    } else {
      // Need to navigate to base furnace area
      console.log('No furnace in range. Going to base...');
      await goNear(-5, 101, -14, 3, 40000);
      const fb2 = bot.findBlock({
        matching: bot.registry.blocksByName['furnace']?.id,
        maxDistance: 10
      });
      if (fb2) {
        await goNear(fb2.position.x, fb2.position.y, fb2.position.z, 2, 10000);
        const fb2b = bot.blockAt(fb2.position);
        try {
          const furnace = await bot.openFurnace(fb2b);
          const coal = bot.inventory.items().find(i => i.name === 'coal');
          const ri = bot.inventory.items().find(i => i.name === 'raw_iron');
          if (coal) await furnace.putFuel(coal.type, null, Math.min(coal.count, 5));
          await sleep(200);
          if (ri) await furnace.putInput(ri.type, null, ri.count);
          await sleep(200);
          console.log('Smelting... waiting', (ri?.count || 1) * 10, 'seconds');
          await sleep((ri?.count || 1) * 10500 + 2000);
          const out = furnace.outputItem();
          console.log('Output:', out?.name, out?.count);
          if (out) await furnace.takeOutput();
          furnace.close();
        } catch(e) { console.log('Furnace error:', e.message); }
      }
    }
  }

  // Get flint - try more gravel
  let flint = bot.inventory.items().find(i => i.name === 'flint');
  const ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  console.log('\nFlint:', flint?.count || 0, 'Iron ingot:', ironIngot?.count || 0);

  if (!flint) {
    // Try more gravel from inventory (place + break repeatedly)
    console.log('\nTrying to get flint from inventory gravel...');
    const gravelItem = bot.inventory.items().find(i => i.name === 'gravel');
    if (gravelItem && gravelItem.count >= 3) {
      const pos = bot.entity.position.clone();
      let attempts = 0;
      let placed = false;

      // Find a surface to place gravel on
      const surface = bot.blockAt(pos.offset(1, -1, 0).floored());
      const targetPos = pos.offset(1, 0, 0).floored();

      if (surface && surface.name !== 'air') {
        await bot.equip(gravelItem, 'hand');
        while (!flint && attempts < gravelItem.count && attempts < 10) {
          try {
            await bot.placeBlock(surface, new Vec3(0, 1, 0));
            await sleep(200);
            const placedGravel = bot.blockAt(targetPos);
            if (placedGravel && placedGravel.name === 'gravel') {
              await bot.dig(placedGravel);
              await sleep(400);
              flint = bot.inventory.items().find(i => i.name === 'flint');
              attempts++;
              console.log('Attempt', attempts, 'flint:', flint?.count || 0);
            } else {
              attempts++;
            }
            // Re-equip gravel for next placement
            const g2 = bot.inventory.items().find(i => i.name === 'gravel');
            if (!g2) break;
            await bot.equip(g2, 'hand');
          } catch(e) {
            console.log('Error placing gravel:', e.message);
            attempts++;
          }
        }
      }
    }
  }

  // Craft flint_and_steel
  flint = bot.inventory.items().find(i => i.name === 'flint');
  const ironIngot2 = bot.inventory.items().find(i => i.name === 'iron_ingot');

  if (flint && ironIngot2) {
    console.log('\n=== Crafting flint_and_steel ===');
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    console.log('Recipes:', recipes.length);
    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        const fas = bot.inventory.items().find(i => i.name === 'flint_and_steel');
        console.log('Crafted flint_and_steel:', fas ? 'YES' : 'NO');
      } catch(e) { console.log('Craft error:', e.message); }
    }
  }

  console.log('\n=== Final Status ===');
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);
  const keyItems = ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel', 'leather'];
  bot.inventory.items().filter(i => keyItems.includes(i.name)).forEach(i => console.log(` ${i.name}x${i.count}`));

  bot.end();
});

bot.on('error', e => { console.error('Error:', e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
