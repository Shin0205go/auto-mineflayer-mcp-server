/**
 * Final resource gathering:
 * 1. Check chest at (-37, 97, 8) for iron ingots
 * 2. Navigate to iron ore at (-8, 101, -80), mine it
 * 3. Smelt at furnace
 * 4. Mine gravel until flint drops
 * 5. Craft flint_and_steel
 * 6. Activate nether portal at (-3 to -6, 102-106, 27)
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

async function goTo(x, y, z, dist = 3, t = 30000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

async function digBlock(block, t = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { bot.stopDigging(); resolve(false); }, t);
    bot.dig(block).then(() => { clearTimeout(timer); resolve(true); })
      .catch(() => { clearTimeout(timer); resolve(true); });
  });
}

bot.once('spawn', async () => {
  await sleep(2000);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Step 1: Check unknown chest at (-37, 97, 8)
  console.log('\n=== Checking chest at (-37, 97, 8) ===');
  const r1 = await goTo(-37, 97, 8, 3, 20000);
  console.log('Nav:', r1, 'at', bot.entity.position);

  const chestBlock = bot.findBlock({ matching: bot.registry.blocksByName['chest']?.id, maxDistance: 6 });
  if (chestBlock) {
    const cb = bot.blockAt(chestBlock.position);
    try {
      const chest = await bot.openContainer(cb);
      const contents = chest.containerItems();
      console.log('Chest contents:', contents.map(i => `${i.name}x${i.count}`).join(', ') || '(empty)');

      // Grab iron_ingot if available
      const ironIngotSlot = contents.find(i => i.name === 'iron_ingot');
      if (ironIngotSlot) {
        await bot.moveSlotItem(ironIngotSlot.slot, bot.inventory.firstEmptyInventorySlot());
        await sleep(300);
        console.log('Got iron_ingot!');
      }

      const flintSlot = contents.find(i => i.name === 'flint');
      if (flintSlot) {
        await bot.moveSlotItem(flintSlot.slot, bot.inventory.firstEmptyInventorySlot());
        await sleep(300);
        console.log('Got flint!');
      }

      chest.close();
    } catch(e) { console.log('Chest error:', e.message); }
  } else {
    console.log('No chest found at (-37, 97, 8)');
  }

  // Step 2: Navigate to iron ore cluster at (-8, 101, -80)
  console.log('\n=== Going to iron ore at (-8, 101, -80) ===');
  const r2 = await goTo(-8, 101, -80, 5, 40000);
  console.log('Nav:', r2, 'at', bot.entity.position);

  if (r2 !== 'noPath') {
    const oreId = bot.registry.blocksByName['iron_ore']?.id;
    const ores = bot.findBlocks({ matching: oreId, maxDistance: 15, count: 10 });
    console.log('Iron ore nearby:', ores.length);

    for (const orePos of ores.slice(0, 6)) {
      const r3 = await goTo(orePos.x, orePos.y, orePos.z, 2, 12000);
      if (r3 === 'noPath') continue;

      const ore = bot.findBlock({ matching: oreId, maxDistance: 3 });
      if (!ore) continue;

      const pick = inv('diamond_pickaxe') || inv('iron_pickaxe');
      if (pick) await bot.equip(pick, 'hand');
      await digBlock(ore);
      await sleep(300);
    }

    const rawIron = invCount('raw_iron');
    console.log('Raw iron after mining:', rawIron);
  }

  // Step 3: Mine gravel for flint (100 gravel blocks available - keep trying!)
  console.log('\n=== Mining gravel for flint ===');
  let flint = invCount('flint');
  let gravelMined = 0;

  while (flint === 0 && gravelMined < 50) {
    const gravelId = bot.registry.blocksByName['gravel']?.id;
    const gb = bot.findBlock({ matching: gravelId, maxDistance: 50 });
    if (!gb) { console.log('No gravel!'); break; }

    const r = await goTo(gb.position.x, gb.position.y, gb.position.z, 2, 8000);
    if (r === 'noPath') {
      // Try finding another gravel block
      continue;
    }

    const closeGravel = bot.findBlock({ matching: gravelId, maxDistance: 3 });
    if (!closeGravel) continue;

    const pick2 = inv('iron_pickaxe');
    if (pick2) await bot.equip(pick2, 'hand');

    await digBlock(closeGravel, 4000);
    await sleep(300);
    gravelMined++;
    flint = invCount('flint');

    if (gravelMined % 10 === 0 || flint > 0) {
      console.log(`Gravel ${gravelMined}: flint=${flint} gravel=${invCount('gravel')}`);
    }
  }

  console.log('Flint result:', flint, '(mined', gravelMined, 'gravel)');

  // Step 4: Smelt raw iron
  const rawIron = invCount('raw_iron');
  console.log('\nRaw iron:', rawIron);

  if (rawIron > 0) {
    console.log('Going to furnace...');
    const r4 = await goTo(-5, 101, -14, 3, 30000);
    console.log('Nav:', r4, 'at', bot.entity.position);

    const furnaceBlock = bot.findBlock({ matching: bot.registry.blocksByName['furnace']?.id, maxDistance: 15 });
    if (furnaceBlock) {
      const fb = bot.blockAt(furnaceBlock.position);
      const furnace = await bot.openFurnace(fb);
      const coal = inv('coal');
      const ri = inv('raw_iron');
      if (coal) await furnace.putFuel(coal.type, null, Math.min(coal.count, 3));
      await sleep(200);
      if (ri) await furnace.putInput(ri.type, null, Math.min(ri.count, 3));
      await sleep(200);
      const waitMs = Math.min(invCount('raw_iron'), 3) * 10500 + 3000;
      console.log('Smelting... waiting', Math.round(waitMs/1000), 's');
      await sleep(waitMs);
      const out = furnace.outputItem();
      if (out) { await furnace.takeOutput(); console.log('Got', out.name, out.count); }
      furnace.close();
      await sleep(300);
    }
  }

  // Step 5: Craft flint_and_steel
  const flintItem = inv('flint');
  const ironIngotItem = inv('iron_ingot');
  console.log('\nFlint:', flintItem?.count || 0, 'Iron ingot:', ironIngotItem?.count || 0);

  if (flintItem && ironIngotItem) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    if (recipes.length > 0) {
      await bot.craft(recipes[0], 1, null);
      console.log('flint_and_steel:', invCount('flint_and_steel') > 0 ? 'CRAFTED!' : 'FAILED');
    }
  }

  // Step 6: Go to portal frame and activate
  const fas = inv('flint_and_steel');
  if (fas) {
    console.log('\n=== Activating nether portal at (-4, 103, 27) ===');
    // Portal frame inner bottom at (-4 to -5, 103, 27)
    const r5 = await goTo(-4, 103, 27, 3, 30000);
    console.log('Nav:', r5, 'at', bot.entity.position);

    // Equip flint_and_steel
    await bot.equip(fas, 'hand');
    await sleep(300);

    // Look for the portal interior blocks
    for (let x = -5; x <= -4; x++) {
      for (let y = 103; y <= 105; y++) {
        const block = bot.blockAt(new Vec3(x, y, 27));
        if (block && block.name === 'air') {
          console.log('Air inside frame at', x, y, 27, '- activating!');
          // Use flint_and_steel on the air block (by right-clicking adjacent obsidian)
          const below = bot.blockAt(new Vec3(x, y - 1, 27));
          if (below) {
            try {
              await bot.activateBlock(below); // Right-click block below the air
              await sleep(500);
              const portalBlock = bot.findBlock({
                matching: bot.registry.blocksByName['nether_portal']?.id,
                maxDistance: 10
              });
              if (portalBlock) {
                console.log('PORTAL ACTIVATED! at', portalBlock.position);
                break;
              }
            } catch(e) { console.log('Activate error:', e.message); }
          }
        }
      }
    }

    // Also try activating by looking at obsidian from inside the frame
    const portalCheck = bot.findBlock({
      matching: bot.registry.blocksByName['nether_portal']?.id,
      maxDistance: 20
    });
    console.log('Portal active:', portalCheck ? 'YES at ' + portalCheck.position : 'NO');
  }

  console.log('\n=== Final Status ===');
  console.log('HP:', bot.health, 'at', bot.entity.position);
  ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel'].forEach(n => {
    const c = invCount(n);
    if (c > 0) console.log(` ${n}x${c}`);
  });

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
