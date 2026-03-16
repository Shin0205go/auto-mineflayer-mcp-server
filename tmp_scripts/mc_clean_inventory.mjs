/**
 * Clean up inventory to make room for iron drops
 * Deposit excess cobblestone and junk into base chests
 * Then mine iron ore and collect
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

async function goTo(x, y, z, dist = 2, t = 30000) {
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

  const movements = new Movements(bot);
  movements.maxDropDown = 3;
  movements.canDig = false; // Don't dig during navigation
  bot.pathfinder.setMovements(movements);

  // Count inventory slots
  const items = bot.inventory.items();
  const freeSlots = 36 - items.length;
  console.log('Inventory slots used:', items.length, 'free:', freeSlots);

  // If full, need to deposit excess
  if (freeSlots < 5) {
    console.log('\n=== Depositing excess items ===');

    // Navigate to base chest area
    await goTo(-7, 98, 3, 3, 30000);
    console.log('At chest area:', bot.entity.position);

    // Find a chest
    const chestId = bot.registry.blocksByName['chest']?.id;
    const chestBlock = bot.findBlock({ matching: chestId, maxDistance: 10 });
    if (chestBlock) {
      await goTo(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1, 10000);
      console.log('Opening chest at:', chestBlock.position);

      try {
        const chest = await bot.openContainer(bot.blockAt(chestBlock.position));

        // Deposit items we don't need immediately:
        // Keep: flint, diamond_pickaxe, iron_pickaxe, diamond_sword, coal, obsidian, diamond, torch
        // Deposit: excess cobblestone, cobbled_deepslate, andesite, granite, diorite, clay_ball, gravel
        const depositItems = ['cobblestone', 'cobbled_deepslate', 'andesite', 'granite', 'diorite',
                              'clay_ball', 'birch_sapling', 'stone_sword', 'stone_pickaxe', 'stone_axe',
                              'gravel', 'soul_sand', 'soul_soil', 'netherrack', 'raw_copper'];

        for (const itemName of depositItems) {
          const itemInInv = bot.inventory.items().filter(i => i.name === itemName);
          for (const item of itemInInv) {
            // Find empty chest slot
            const chestItems = chest.containerItems();
            const existingStack = chestItems.find(ci => ci.name === itemName && ci.count < 64);
            if (existingStack) {
              // Stack onto existing
              await bot.moveSlotItem(item.slot, existingStack.slot);
            } else {
              // Find empty slot in chest
              let emptySlot = -1;
              for (let s = 0; s < 27; s++) {
                if (!chestItems.find(ci => ci.slot === s)) {
                  emptySlot = s;
                  break;
                }
              }
              if (emptySlot >= 0) {
                await bot.moveSlotItem(item.slot, emptySlot);
              }
            }
            await sleep(100);
          }
        }

        chest.close();
        await sleep(300);
        console.log('After deposit - inv slots:', bot.inventory.items().length);
      } catch(e) { console.log('Chest error:', e.message); }
    } else {
      // Drop excess cobblestone on ground
      console.log('No chest found! Dropping excess cobblestone...');
      const cobblestoneStacks = bot.inventory.items().filter(i => i.name === 'cobblestone');
      // Keep only 1 stack
      for (const stack of cobblestoneStacks.slice(1)) {
        await bot.tossStack(stack);
        await sleep(200);
      }
      console.log('After drop - inv slots:', bot.inventory.items().length);
    }
  }

  console.log('\nInventory after cleanup:', bot.inventory.items().length, 'items');
  console.log('Free slots:', 36 - bot.inventory.items().length);

  // Now mine iron ore
  console.log('\n=== Mining iron ore ===');

  // Navigate to iron ore area (canDig=false to prevent auto-mining)
  movements.canDig = false;
  const r = await goTo(10, 93, -106, 4, 30000);
  console.log('At ore area:', r, 'at', bot.entity.position);

  // Enable digging
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Find iron ore
  const oreId = bot.registry.blocksByName['iron_ore']?.id;
  let ores = bot.findBlocks({ matching: oreId, maxDistance: 20, count: 5 });
  console.log('Iron ore nearby:', ores.length);

  for (const orePos of ores) {
    const dist = orePos.distanceTo(bot.entity.position);
    console.log(` ore at (${orePos.x},${orePos.y},${orePos.z}) dist=${dist.toFixed(1)}`);
  }

  for (const orePos of ores) {
    // Navigate to be ADJACENT (dist=1) to ore
    const r2 = await goTo(orePos.x, orePos.y, orePos.z, 1, 12000);
    if (r2 === 'noPath') {
      console.log('Cannot reach ore at', orePos);
      continue;
    }

    const oreBlock = bot.blockAt(new Vec3(orePos.x, orePos.y, orePos.z));
    if (!oreBlock || !oreBlock.name.includes('ore')) {
      console.log('Ore gone at', orePos, '(was', oreBlock?.name, ')');
      continue;
    }

    const rawBefore = invCount('raw_iron');
    const invBefore = bot.inventory.items().length;

    const pick = inv('diamond_pickaxe') || inv('iron_pickaxe');
    if (pick) await bot.equip(pick, 'hand');

    console.log(`Mining ${oreBlock.name} at ${orePos}, dist=${orePos.distanceTo(bot.entity.position).toFixed(1)}`);

    // Mine the block
    await bot.dig(oreBlock);
    await sleep(200);

    // IMMEDIATELY walk to exact ore position to collect drop
    const r3 = await goTo(orePos.x, orePos.y, orePos.z, 0, 3000);
    await sleep(500);

    const rawAfter = invCount('raw_iron');
    const invAfter = bot.inventory.items().length;
    console.log(`  raw_iron: ${rawBefore} -> ${rawAfter} | inv slots: ${invBefore} -> ${invAfter}`);

    // Check for nearby items
    const drops = Object.values(bot.entities).filter(e =>
      e.type === 'object' && e.objectType === 'Item' &&
      e.position.distanceTo(new Vec3(orePos.x, orePos.y, orePos.z)) < 3
    );
    if (drops.length > 0) {
      console.log(`  ${drops.length} items on ground near ore spot`);
      // Walk to them
      for (const drop of drops) {
        await goTo(drop.position.x, drop.position.y, drop.position.z, 0, 3000);
        await sleep(300);
      }
    }

    const rawFinal = invCount('raw_iron');
    if (rawFinal > 0) {
      console.log('GOT RAW IRON:', rawFinal);
      break;
    }
  }

  const rawIron = invCount('raw_iron');
  console.log('\nRaw iron:', rawIron);

  // Smelt
  if (rawIron > 0) {
    console.log('Going to furnace...');
    movements.canDig = false;
    await goTo(-5, 101, -14, 4, 40000);
    console.log('At furnace area:', bot.entity.position);

    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 10 });
    if (furnaceBlock) {
      await goTo(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 10000);
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
  console.log('\nFlint:', flint, 'Iron:', iron);

  if (flint > 0 && iron > 0) {
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
