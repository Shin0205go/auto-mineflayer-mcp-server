/**
 * Get flint (from gravel) + mine iron ore + smelt = iron ingot
 * Then craft flint_and_steel to activate nether portal
 * Portal frame at (-3 to -6, 102-106, 27) - appears to be complete!
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

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function goNear(x, y, z, dist = 2, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, timeoutMs);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

bot.once('spawn', async () => {
  await sleep(1500);
  console.log('Position:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Check current inventory
  const invSummary = () => bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ');
  console.log('Inventory:', invSummary());

  // Step 1: Get flint from gravel (have 5 gravel in inventory)
  console.log('\n=== Getting flint from gravel ===');
  let flint = bot.inventory.items().find(i => i.name === 'flint');

  if (!flint) {
    // Need to place and break gravel blocks to get flint
    // Or find gravel on ground and mine it
    const gravelBlock = bot.findBlock({
      matching: bot.registry.blocksByName['gravel']?.id,
      maxDistance: 50
    });

    if (gravelBlock) {
      console.log('Found gravel at:', gravelBlock.position);
      await goNear(gravelBlock.position.x, gravelBlock.position.y, gravelBlock.position.z, 3, 15000);

      // Mine multiple gravel blocks for flint
      let attempts = 0;
      while (!bot.inventory.items().find(i => i.name === 'flint') && attempts < 10) {
        const gb = bot.findBlock({
          matching: bot.registry.blocksByName['gravel']?.id,
          maxDistance: 10
        });
        if (!gb) break;
        try {
          await bot.dig(gb);
          await sleep(500);
          attempts++;
          console.log(`Mined gravel ${attempts}, flint: ${bot.inventory.items().find(i => i.name === 'flint')?.count || 0}`);
        } catch(e) {
          console.log('Dig error:', e.message);
          break;
        }
      }
    } else {
      // Place and break gravel from inventory
      console.log('No gravel blocks nearby. Using inventory gravel (5 pieces)...');
      const gravelItem = bot.inventory.items().find(i => i.name === 'gravel');
      if (!gravelItem) {
        console.log('ERROR: No gravel in inventory!');
        bot.end();
        return;
      }

      // Find a spot to place gravel
      const placePosVec = bot.entity.position.offset(1, 0, 0).floored();
      const groundBlock = bot.blockAt(placePosVec.offset(0, -1, 0));
      if (groundBlock && groundBlock.name !== 'air') {
        await bot.equip(gravelItem, 'hand');
        for (let i = 0; i < Math.min(gravelItem.count, 5); i++) {
          try {
            // Place against ground
            const refBlock = bot.blockAt(placePosVec.offset(0, -1, 0));
            await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
            await sleep(300);
            const placedGravel = bot.blockAt(placePosVec);
            if (placedGravel && placedGravel.name === 'gravel') {
              await bot.dig(placedGravel);
              await sleep(300);
              if (bot.inventory.items().find(i2 => i2.name === 'flint')) {
                console.log('Got flint from placed gravel!');
                break;
              }
            }
          } catch(e) {
            console.log('Place/dig gravel error:', e.message);
          }
        }
      }
    }

    flint = bot.inventory.items().find(i => i.name === 'flint');
    console.log('Flint:', flint ? flint.count : 0);
  } else {
    console.log('Already have flint:', flint.count);
  }

  if (!flint) {
    console.log('Could not get flint! Trying to find and mine more gravel...');
    // Search wider
    const gravelBlocks = bot.findBlocks({
      matching: bot.registry.blocksByName['gravel']?.id,
      maxDistance: 100,
      count: 20
    });
    console.log('Gravel blocks within 100:', gravelBlocks.length);
    gravelBlocks.slice(0, 5).forEach(p => console.log(` ${p.x},${p.y},${p.z}`));

    if (gravelBlocks.length > 0) {
      const firstGravel = gravelBlocks[0];
      await goNear(firstGravel.x, firstGravel.y, firstGravel.z, 3, 20000);
      console.log('At gravel. Mining...');

      for (let i = 0; i < 10 && !bot.inventory.items().find(ii => ii.name === 'flint'); i++) {
        const gb = bot.findBlock({
          matching: bot.registry.blocksByName['gravel']?.id,
          maxDistance: 5
        });
        if (!gb) break;
        try {
          await bot.dig(gb);
          await sleep(500);
        } catch(e) { break; }
      }
      flint = bot.inventory.items().find(i => i.name === 'flint');
      console.log('Flint after mining:', flint ? flint.count : 0);
    }
  }

  // Step 2: Get iron ingot
  console.log('\n=== Getting iron ingot ===');
  let ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  console.log('Iron ingot in inventory:', ironIngot ? ironIngot.count : 0);

  if (!ironIngot) {
    // Find and mine iron ore
    const ironOreNames = ['iron_ore', 'deepslate_iron_ore'];
    let ironOreSources = [];
    for (const name of ironOreNames) {
      const id = bot.registry.blocksByName[name]?.id;
      if (id) {
        const found = bot.findBlocks({ matching: id, maxDistance: 50, count: 5 });
        ironOreSources = ironOreSources.concat(found);
      }
    }
    console.log('Iron ore nearby:', ironOreSources.length);

    if (ironOreSources.length === 0) {
      console.log('No iron ore nearby! Mining down to find some...');
      // Mine down near base
      const startPos = bot.entity.position.clone();
      for (let dy = 0; dy < 30; dy++) {
        const blockBelow = bot.blockAt(new Vec3(Math.round(startPos.x), Math.round(startPos.y) - dy - 1, Math.round(startPos.z)));
        if (blockBelow && ['iron_ore', 'deepslate_iron_ore'].includes(blockBelow.name)) {
          console.log('Found iron ore at y=', blockBelow.position.y);
          ironOreSources.push(blockBelow.position);
          break;
        }
      }
    }

    // Find raw_iron in inventory or nearby chests
    const rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
    console.log('Raw iron:', rawIron ? rawIron.count : 0);

    if (ironOreSources.length > 0 || rawIron) {
      // Navigate to ore and mine
      if (ironOreSources.length > 0 && !rawIron) {
        const orePos = ironOreSources[0];
        console.log('Mining iron ore at:', orePos);
        await goNear(orePos.x, orePos.y, orePos.z, 3, 20000);

        // Mine ore
        const oreBlock = bot.blockAt(new Vec3(orePos.x, orePos.y, orePos.z));
        if (oreBlock) {
          try {
            // Equip iron pickaxe
            const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe' || i.name === 'diamond_pickaxe');
            if (pick) await bot.equip(pick, 'hand');
            await bot.dig(oreBlock);
            await sleep(500);
          } catch(e) {
            console.log('Mine error:', e.message);
          }
        }
      }

      // Smelt raw_iron
      const rawIronNow = bot.inventory.items().find(i => i.name === 'raw_iron');
      console.log('Raw iron after mining:', rawIronNow ? rawIronNow.count : 0);

      if (rawIronNow) {
        // Find furnace
        const furnaceBlock = bot.findBlock({
          matching: bot.registry.blocksByName['furnace']?.id,
          maxDistance: 30
        });
        console.log('Furnace:', furnaceBlock ? furnaceBlock.position : 'none');

        if (furnaceBlock) {
          console.log('Smelting raw_iron...');
          await goNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 10000);
          const furnaceBlockObj = bot.blockAt(furnaceBlock.position);

          try {
            const furnace = await bot.openFurnace(furnaceBlockObj);
            console.log('Furnace opened. Fuel:', furnace.fuelItem(), 'Input:', furnace.inputItem(), 'Output:', furnace.outputItem());

            // Add fuel (coal)
            const coal = bot.inventory.items().find(i => i.name === 'coal');
            if (coal) {
              await furnace.putFuel(coal.type, null, 1);
              await sleep(500);
            }

            // Add raw iron
            const ri = bot.inventory.items().find(i => i.name === 'raw_iron');
            if (ri) {
              await furnace.putInput(ri.type, null, 1);
              await sleep(500);
            }

            // Wait for smelting (10 seconds)
            console.log('Waiting for smelting...');
            await sleep(12000);

            const output = furnace.outputItem();
            console.log('Output:', output);
            if (output) {
              await furnace.takeOutput();
              await sleep(500);
            }
            furnace.close();
          } catch(e) {
            console.log('Furnace error:', e.message);
          }
        } else {
          console.log('No furnace nearby! Checking inventory for furnace...');
          const furnaceItem = bot.inventory.items().find(i => i.name === 'furnace');
          if (furnaceItem) {
            console.log('Have furnace in inventory. Need to place it.');
            // TODO: place furnace
          }
        }
      }
    }

    ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
    console.log('Iron ingot now:', ironIngot ? ironIngot.count : 0);
  }

  // Step 3: Craft flint_and_steel
  if (flint && ironIngot) {
    console.log('\n=== Crafting flint_and_steel ===');
    // Flint and steel doesn't need crafting table
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    console.log('Recipes for flint_and_steel:', recipes.length);

    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        console.log('Crafted flint_and_steel!');
      } catch(e) {
        console.log('Craft error:', e.message);
        // Try with crafting table
        const ct = bot.findBlock({ matching: bot.registry.blocksByName['crafting_table']?.id, maxDistance: 30 });
        if (ct) {
          await goNear(ct.position.x, ct.position.y, ct.position.z, 1, 10000);
          const ctBlock = bot.blockAt(ct.position);
          const recipesWithCT = bot.recipesFor(fasId, null, 1, ctBlock);
          console.log('Recipes with CT:', recipesWithCT.length);
          if (recipesWithCT.length > 0) {
            await bot.craft(recipesWithCT[0], 1, ctBlock);
            console.log('Crafted flint_and_steel with CT!');
          }
        }
      }
    }
  } else {
    console.log('Cannot craft flint_and_steel: flint=', !!flint, 'ironIngot=', !!ironIngot);
  }

  // Final status
  console.log('\n=== Final Status ===');
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);
  const inv = bot.inventory.items();
  console.log('Key items:', inv.filter(i =>
    ['flint', 'iron_ingot', 'flint_and_steel', 'raw_iron'].includes(i.name)
  ).map(i => `${i.name}x${i.count}`).join(', ') || 'none');

  bot.end();
});

bot.on('error', e => { console.error('Bot error:', e.message); process.exit(1); });
bot.on('end', () => { process.exit(0); });
