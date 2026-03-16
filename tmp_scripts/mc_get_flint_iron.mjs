/**
 * Simple: navigate to iron ore at (-46, 63, -7), mine it, smelt it
 * Also try to get flint by checking what's dropping from gravel
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

async function goNear(x, y, z, dist = 2, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, timeoutMs);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

bot.on('playerCollect', (collector, item) => {
  if (collector.username === bot.username) {
    console.log('  Picked up:', item?.metadata?.name || '?');
  }
});

bot.on('entityDrop', (entity) => {
  console.log('  Item dropped on ground:', entity.metadata?.[8]?.itemId);
});

bot.once('spawn', async () => {
  await sleep(1500);
  console.log('Position:', bot.entity.position, 'HP:', bot.health);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Equip iron pickaxe
  const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe');
  if (pick) await bot.equip(pick, 'hand');

  // Step 1: Test gravel drop - mine one block and listen for drops
  console.log('\n=== Testing gravel drop ===');
  const gravelBlock = bot.findBlock({
    matching: bot.registry.blocksByName['gravel']?.id,
    maxDistance: 30
  });

  if (gravelBlock) {
    console.log('Gravel at:', gravelBlock.position);
    console.log('Bot position:', bot.entity.position);
    await goNear(gravelBlock.position.x, gravelBlock.position.y, gravelBlock.position.z, 3, 10000);

    const gb = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 5 });
    if (gb) {
      console.log('Mining gravel block at:', gb.position);
      console.log('Tool in hand:', bot.heldItem?.name);

      // Listen for entities spawning near gravel
      const entityListener = (entity) => {
        if (entity.type === 'object') {
          console.log('Entity spawned nearby (item?):', entity.objectType, entity.position);
        }
      };
      bot.on('entitySpawn', entityListener);

      await bot.dig(gb);
      await sleep(1000);
      bot.removeListener('entitySpawn', entityListener);

      // Check nearby items
      const items = Object.values(bot.entities).filter(e =>
        e.type === 'object' && e.objectType === 'Item' &&
        e.position.distanceTo(bot.entity.position) < 5
      );
      console.log('Items on ground nearby:', items.length);
      items.forEach(item => {
        console.log(' Item entity metadata:', JSON.stringify(item.metadata?.slice(0, 10)));
      });

      // Check inventory for flint or gravel
      const invAfter = bot.inventory.items().filter(i => ['flint', 'gravel'].includes(i.name));
      console.log('Flint/gravel in inv:', invAfter.map(i => `${i.name}x${i.count}`).join(', ') || 'none');
    }
  }

  // Try mining gravel WITHOUT a tool (hand) - sometimes tool silktouch can prevent drops
  console.log('\n=== Mining gravel with no tool ===');
  const gravelBlock2 = bot.findBlock({
    matching: bot.registry.blocksByName['gravel']?.id,
    maxDistance: 30
  });
  if (gravelBlock2) {
    await bot.unequip('hand');
    await goNear(gravelBlock2.position.x, gravelBlock2.position.y, gravelBlock2.position.z, 3, 10000);
    const gb2 = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 5 });
    if (gb2) {
      console.log('Mining with bare hand...');
      await bot.dig(gb2);
      await sleep(1000);
      const invAfter = bot.inventory.items().filter(i => ['flint', 'gravel'].includes(i.name));
      console.log('Flint/gravel in inv:', invAfter.map(i => `${i.name}x${i.count}`).join(', ') || 'none');
    }
  }

  // Step 2: Navigate to iron ore
  console.log('\n=== Navigating to iron ore at (-46, 63, -7) ===');
  const oreX = -46, oreY = 63, oreZ = -7;
  const result = await goNear(oreX, oreY, oreZ, 3, 40000);
  console.log('Navigation result:', result, 'at', bot.entity.position);

  if (result !== 'noPath') {
    // Look for iron ore nearby
    for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
      const id = bot.registry.blocksByName[oreName]?.id;
      const found = bot.findBlock({ matching: id, maxDistance: 10 });
      if (found) {
        console.log('Found', oreName, 'at', found.position);
        const p = bot.inventory.items().find(i => i.name.includes('pickaxe'));
        if (p) await bot.equip(p, 'hand');
        await goNear(found.position.x, found.position.y, found.position.z, 2, 10000);
        await bot.dig(found);
        await sleep(500);
        const rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
        console.log('Raw iron:', rawIron ? rawIron.count : 0);
        if (rawIron) break;
      }
    }
  }

  // Step 3: Smelt raw_iron
  const rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
  console.log('\nRaw iron:', rawIron ? rawIron.count : 0);

  if (rawIron) {
    // Find furnace
    const furnaceBlock = bot.findBlock({
      matching: bot.registry.blocksByName['furnace']?.id,
      maxDistance: 100
    });
    console.log('Furnace:', furnaceBlock ? furnaceBlock.position : 'none');

    if (furnaceBlock) {
      await goNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 30000);
      const fb = bot.blockAt(furnaceBlock.position);
      try {
        const furnace = await bot.openFurnace(fb);
        const coal = bot.inventory.items().find(i => i.name === 'coal');
        const ri = bot.inventory.items().find(i => i.name === 'raw_iron');
        if (coal) await furnace.putFuel(coal.type, null, 1);
        if (ri) await furnace.putInput(ri.type, null, 1);
        console.log('Smelting... waiting 12s');
        await sleep(12000);
        const out = furnace.outputItem();
        console.log('Output:', out?.name);
        if (out) await furnace.takeOutput();
        furnace.close();
      } catch(e) { console.log('Furnace error:', e.message); }
    }
  }

  // Final status
  const ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  const flint = bot.inventory.items().find(i => i.name === 'flint');
  console.log('\nFlint:', flint ? flint.count : 0, '| Iron ingot:', ironIngot ? ironIngot.count : 0);

  // Craft flint_and_steel if we have both
  if (flint && ironIngot) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        console.log('CRAFTED flint_and_steel!');
      } catch(e) { console.log('Craft error:', e.message); }
    }
  }

  console.log('\nFinal inventory key items:', bot.inventory.items().filter(i =>
    ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].includes(i.name)
  ).map(i => `${i.name}x${i.count}`).join(', ') || 'none');
  console.log('HP:', bot.health, 'Pos:', bot.entity.position);

  bot.end();
});

bot.on('error', e => { console.error('Error:', e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
