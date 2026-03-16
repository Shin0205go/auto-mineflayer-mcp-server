/**
 * Test gravel drop systematically:
 * 1. Check tool enchantments (silk touch would prevent flint)
 * 2. Mine gravel with HAND (no tool) - guarantees eventual flint
 * 3. Check what items drop from gravel
 * Also navigate to iron ore at (-1, 108, -80) which is nearby
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
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Check tool enchantments
  console.log('\n=== Checking tool enchantments ===');
  const tools = bot.inventory.items().filter(i => i.name.includes('pickaxe') || i.name.includes('axe'));
  tools.forEach(t => {
    const nbt = t.nbt;
    console.log(`${t.name}: nbt=${JSON.stringify(nbt)?.substring(0, 200)}`);
  });

  // Check gravel count
  const gravelBefore = bot.inventory.items().find(i => i.name === 'gravel')?.count || 0;
  console.log('\nGravel in inv before:', gravelBefore);

  // Try mining gravel with NO tool (bare hand)
  console.log('\n=== Mining gravel with BARE HAND ===');
  await bot.unequip('hand');
  console.log('Hand item:', bot.heldItem?.name || 'empty');

  const gravelNear = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 30 });
  if (gravelNear) {
    console.log('Gravel at:', gravelNear.position);
    await goNear(gravelNear.position.x, gravelNear.position.y, gravelNear.position.z, 2, 10000);

    const gb = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 3 });
    if (gb) {
      console.log('Mining gravel at:', gb.position, 'with', bot.heldItem?.name || 'hand');

      // Track entity spawns
      const spawned = [];
      const listener = (e) => {
        if (e.type === 'object') spawned.push(e);
      };
      bot.on('entitySpawn', listener);

      const before = { ...Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])) };
      await bot.dig(gb);
      await sleep(800); // Wait for drop to spawn
      bot.removeListener('entitySpawn', listener);

      const after = { ...Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])) };

      // Find changes
      const changes = [];
      const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of allKeys) {
        const diff = (after[key] || 0) - (before[key] || 0);
        if (diff !== 0) changes.push(`${key}: ${before[key] || 0} -> ${after[key] || 0} (${diff > 0 ? '+' : ''}${diff})`);
      }
      console.log('Inventory changes:', changes.join(', ') || 'none');
      console.log('Entity spawns:', spawned.length);

      // Move to collect drops
      const dropEntities = Object.values(bot.entities).filter(e =>
        e.type === 'object' && e.objectType === 'Item' &&
        e.position.distanceTo(gb.position) < 5
      );
      console.log('Drop items on ground:', dropEntities.length);
    }
  }

  // Mine 5 more gravel with bare hand
  let flint = bot.inventory.items().find(i => i.name === 'flint');
  let mined = 0;
  while (!flint && mined < 15) {
    const gb2 = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 30 });
    if (!gb2) { console.log('No more gravel!'); break; }

    const result = await goNear(gb2.position.x, gb2.position.y, gb2.position.z, 2, 10000);
    if (result === 'noPath') continue;

    const gb3 = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 3 });
    if (!gb3) continue;

    await bot.dig(gb3);
    await sleep(600);
    mined++;
    flint = bot.inventory.items().find(i => i.name === 'flint');
    const gravelNow = bot.inventory.items().find(i => i.name === 'gravel')?.count || 0;
    console.log(`Mine ${mined}: flint=${flint?.count || 0} gravel=${gravelNow}`);
  }

  console.log('\nFlint result:', flint?.count || 0, '(mined', mined, 'gravel with bare hand)');

  // Navigate to iron ore at (-1, 108, -80)
  console.log('\n=== Going to iron ore at (-1, 108, -80) ===');
  const result2 = await goNear(-1, 108, -80, 3, 40000);
  console.log('Nav result:', result2, 'at', bot.entity.position);

  if (result2 !== 'noPath') {
    // Look for iron ore
    for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
      const id = bot.registry.blocksByName[oreName]?.id;
      const found = bot.findBlock({ matching: id, maxDistance: 6 });
      if (found) {
        console.log('Found', oreName, 'at', found.position);
        const pick = bot.inventory.items().find(i => i.name.includes('pickaxe'));
        if (pick) await bot.equip(pick, 'hand');
        await goNear(found.position.x, found.position.y, found.position.z, 2, 10000);
        const closeOre = bot.findBlock({ matching: id, maxDistance: 3 });
        if (closeOre) {
          const rawBefore2 = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;
          await bot.dig(closeOre);
          await sleep(400);
          const rawAfter2 = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;
          console.log('raw_iron:', rawBefore2, '->', rawAfter2);

          // Mine more
          for (let e = 0; e < 5; e++) {
            const more = bot.findBlock({ matching: id, maxDistance: 8 });
            if (!more) break;
            await goNear(more.position.x, more.position.y, more.position.z, 2, 8000);
            const m = bot.findBlock({ matching: id, maxDistance: 3 });
            if (m) { await bot.dig(m); await sleep(300); }
          }

          const rawFinal = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;
          console.log('Total raw_iron:', rawFinal);
        }
        break;
      }
    }
  }

  // Smelt iron
  const rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
  let ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  console.log('\nRaw iron:', rawIron?.count || 0, '| Iron ingot:', ironIngot?.count || 0);

  if (rawIron && !ironIngot) {
    const fb = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 200 });
    if (fb) {
      console.log('Furnace at:', fb.position, 'Going there...');
      await goNear(fb.position.x, fb.position.y, fb.position.z, 2, 40000);
      const fbBlock = bot.blockAt(fb.position);
      try {
        const furnace = await bot.openFurnace(fbBlock);
        const coal = bot.inventory.items().find(i => i.name === 'coal');
        const ri = bot.inventory.items().find(i => i.name === 'raw_iron');
        if (coal) await furnace.putFuel(coal.type, null, 2);
        await sleep(200);
        if (ri) await furnace.putInput(ri.type, null, Math.min(ri.count, 3));
        await sleep(200);
        const waitTime = Math.min(ri.count, 3) * 10500 + 2000;
        console.log('Waiting', Math.round(waitTime / 1000), 's for smelting...');
        await sleep(waitTime);
        const out = furnace.outputItem();
        if (out) { await furnace.takeOutput(); console.log('Got:', out.name, out.count); }
        furnace.close();
      } catch(e) { console.log('Furnace error:', e.message); }
    }
  }

  // Final craft
  flint = bot.inventory.items().find(i => i.name === 'flint');
  ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  console.log('\nFlint:', flint?.count || 0, '| Iron ingot:', ironIngot?.count || 0);

  if (flint && ironIngot) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        const fas = bot.inventory.items().find(i => i.name === 'flint_and_steel');
        console.log('flint_and_steel crafted:', fas ? 'YES!' : 'NO');
      } catch(e) { console.log('Craft error:', e.message); }
    }
  }

  console.log('\n=== Final ===');
  console.log('HP:', bot.health, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].forEach(name => {
    const item = bot.inventory.items().find(i => i.name === name);
    if (item) console.log(` ${item.name}x${item.count}`);
  });

  bot.end();
});

bot.on('error', e => { console.error('Error:', e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
