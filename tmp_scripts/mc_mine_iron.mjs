/**
 * Mine down to find iron ore, smelt it, get iron ingot, then find more gravel for flint
 * Bot is at y=111, needs to get to y~=30-50 for iron
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

async function goNear(x, y, z, dist = 2, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, timeoutMs);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

// Mine a block using dig() with timeout
async function digBlock(block, timeoutMs = 10000) {
  if (!block || block.name === 'air') return false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bot.stopDigging();
      resolve(false);
    }, timeoutMs);

    const onUpdate = () => { clearTimeout(timer); resolve(true); };
    bot.once(`blockUpdate:${block.position}`, onUpdate);

    bot.dig(block, false).then(() => {
      clearTimeout(timer);
      bot.removeListener(`blockUpdate:${block.position}`, onUpdate);
      resolve(true);
    }).catch(e => {
      clearTimeout(timer);
      bot.removeListener(`blockUpdate:${block.position}`, onUpdate);
      resolve(true); // blockUpdate already fired
    });
  });
}

bot.once('spawn', async () => {
  await sleep(1500);
  console.log('Position:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Equip iron_pickaxe for mining
  const pick = bot.inventory.items().find(i => i.name === 'iron_pickaxe' || i.name === 'diamond_pickaxe');
  if (pick) {
    await bot.equip(pick, 'hand');
    console.log('Equipped:', pick.name);
  }

  // Step 1: Mine gravel widely for flint
  console.log('\n=== Mining gravel for flint ===');
  const gravelBlocks = bot.findBlocks({
    matching: bot.registry.blocksByName['gravel']?.id,
    maxDistance: 100,
    count: 50
  });
  console.log('Gravel within 100:', gravelBlocks.length);

  let flint = bot.inventory.items().find(i => i.name === 'flint');
  let gravelMined = 0;
  for (const gPos of gravelBlocks) {
    if (flint) break;
    if (gravelMined >= 20) break;

    const gb = bot.blockAt(new Vec3(gPos.x, gPos.y, gPos.z));
    if (!gb || gb.name !== 'gravel') continue;

    const result = await goNear(gPos.x, gPos.y, gPos.z, 3, 10000);
    if (result === 'noPath') continue;

    const gb2 = bot.findBlock({ matching: bot.registry.blocksByName['gravel']?.id, maxDistance: 5 });
    if (!gb2) continue;

    await digBlock(gb2, 3000);
    gravelMined++;
    await sleep(300);
    flint = bot.inventory.items().find(i => i.name === 'flint');
    if (gravelMined % 5 === 0 || flint) {
      console.log(`Mined ${gravelMined} gravel, flint: ${flint ? flint.count : 0}`);
    }
  }

  flint = bot.inventory.items().find(i => i.name === 'flint');
  console.log('Flint result:', flint ? flint.count : 0, '(mined', gravelMined, 'gravel)');

  // Step 2: Find iron ore - search near base surface then dig down
  console.log('\n=== Finding iron ore ===');
  let ironOrePos = null;

  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    if (!id) continue;
    const found = bot.findBlocks({ matching: id, maxDistance: 100, count: 5 });
    if (found.length > 0) {
      ironOrePos = found[0];
      console.log(`Found ${oreName} at:`, ironOrePos);
      break;
    }
  }

  if (!ironOrePos) {
    // Dig down straight from current position to find iron
    console.log('No iron ore visible. Digging down to y=50...');
    const startX = Math.round(bot.entity.position.x);
    const startZ = Math.round(bot.entity.position.z);
    let currentY = Math.round(bot.entity.position.y);

    while (currentY > 50 && !ironOrePos) {
      const blockBelow = bot.blockAt(new Vec3(startX, currentY - 1, startZ));
      const blockBelow2 = bot.blockAt(new Vec3(startX, currentY - 2, startZ));

      if (blockBelow && !['air', 'water', 'lava'].includes(blockBelow.name)) {
        // Check if it's iron ore
        if (blockBelow.name === 'iron_ore' || blockBelow.name === 'deepslate_iron_ore') {
          ironOrePos = blockBelow.position;
          console.log('Found iron ore below at y=', currentY - 1);
          break;
        }
        // Dig it
        await digBlock(blockBelow, 5000);
        await sleep(200);
      }

      if (blockBelow2 && !['air', 'water', 'lava'].includes(blockBelow2.name)) {
        if (blockBelow2.name === 'iron_ore' || blockBelow2.name === 'deepslate_iron_ore') {
          ironOrePos = blockBelow2.position;
          console.log('Found iron ore below at y=', currentY - 2);
          break;
        }
        await digBlock(blockBelow2, 5000);
        await sleep(200);
      }

      currentY -= 2;
      // Small safety check
      if (bot.health < 8) {
        console.log('HP low!', bot.health, 'stopping dig');
        break;
      }
    }

    // Check if ore appeared in visible range
    for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
      const id = bot.registry.blocksByName[oreName]?.id;
      if (!id) continue;
      const found = bot.findBlocks({ matching: id, maxDistance: 20, count: 5 });
      if (found.length > 0) {
        ironOrePos = found[0];
        console.log(`Found ${oreName} after digging at:`, ironOrePos);
        break;
      }
    }
  }

  // Step 3: Mine iron ore
  let rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
  console.log('Raw iron:', rawIron ? rawIron.count : 0);

  if (ironOrePos && !rawIron) {
    const oreVec = new Vec3(ironOrePos.x, ironOrePos.y, ironOrePos.z);
    console.log('Mining iron ore at:', ironOrePos);
    await goNear(ironOrePos.x, ironOrePos.y, ironOrePos.z, 3, 15000);

    const oreBlock = bot.findBlock({
      matching: b => b.name === 'iron_ore' || b.name === 'deepslate_iron_ore',
      maxDistance: 5
    });
    if (oreBlock) {
      const p = bot.inventory.items().find(i => i.name.includes('pickaxe'));
      if (p) await bot.equip(p, 'hand');
      await digBlock(oreBlock, 8000);
      await sleep(500);
    }

    rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
    console.log('Raw iron after mining:', rawIron ? rawIron.count : 0);
  }

  // Step 4: Smelt raw iron
  let ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  if (!ironIngot && rawIron) {
    console.log('\n=== Smelting raw iron ===');

    // Find or place furnace
    let furnaceBlock = bot.findBlock({
      matching: bot.registry.blocksByName['furnace']?.id,
      maxDistance: 50
    });
    console.log('Furnace found:', furnaceBlock ? furnaceBlock.position : 'no');

    if (!furnaceBlock) {
      // Place furnace from inventory
      const furnaceItem = bot.inventory.items().find(i => i.name === 'furnace');
      if (furnaceItem) {
        console.log('Placing furnace from inventory...');
        const groundRef = bot.blockAt(bot.entity.position.offset(1, -1, 0).floored());
        if (groundRef && groundRef.name !== 'air') {
          try {
            await bot.equip(furnaceItem, 'hand');
            await bot.placeBlock(groundRef, new Vec3(0, 1, 0));
            furnaceBlock = bot.findBlock({
              matching: bot.registry.blocksByName['furnace']?.id,
              maxDistance: 5
            });
            console.log('Furnace placed:', furnaceBlock ? furnaceBlock.position : 'failed');
          } catch(e) {
            console.log('Place furnace error:', e.message);
          }
        }
      }
    }

    if (furnaceBlock) {
      await goNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2, 10000);
      const fb = bot.blockAt(furnaceBlock.position);

      try {
        const furnace = await bot.openFurnace(fb);
        console.log('Furnace opened. Input:', furnace.inputItem()?.name, 'Fuel:', furnace.fuelItem()?.name, 'Output:', furnace.outputItem()?.name);

        const coal = bot.inventory.items().find(i => i.name === 'coal');
        const ri = bot.inventory.items().find(i => i.name === 'raw_iron');

        if (coal) {
          console.log('Adding fuel:', coal.name);
          await furnace.putFuel(coal.type, null, 1);
          await sleep(300);
        }

        if (ri) {
          console.log('Adding input:', ri.name);
          await furnace.putInput(ri.type, null, 1);
          await sleep(300);
        }

        console.log('Waiting 12s for smelting...');
        await sleep(12000);

        const output = furnace.outputItem();
        console.log('Output item:', output?.name);
        if (output) {
          await furnace.takeOutput();
          await sleep(300);
          console.log('Took output!');
        }
        furnace.close();
      } catch(e) {
        console.log('Furnace error:', e.message);
      }
    }

    ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
    console.log('Iron ingot after smelt:', ironIngot ? ironIngot.count : 0);
  }

  // Step 5: Craft flint_and_steel
  flint = bot.inventory.items().find(i => i.name === 'flint');
  ironIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  console.log('\n=== Crafting check ===');
  console.log('Flint:', flint ? flint.count : 0, 'Iron ingot:', ironIngot ? ironIngot.count : 0);

  if (flint && ironIngot) {
    const fasId = bot.registry.itemsByName['flint_and_steel']?.id;
    const recipes = bot.recipesFor(fasId, null, 1, null);
    console.log('Flint_and_steel recipes:', recipes.length);

    if (recipes.length > 0) {
      try {
        await bot.craft(recipes[0], 1, null);
        const fas = bot.inventory.items().find(i => i.name === 'flint_and_steel');
        console.log('CRAFTED flint_and_steel!', fas ? 'YES' : 'NO');
      } catch(e) {
        console.log('Craft error:', e.message);
      }
    }
  }

  // Final status
  console.log('\n=== Final Status ===');
  console.log('Pos:', bot.entity.position, 'HP:', bot.health, 'Hunger:', bot.food);
  const keyItems = bot.inventory.items().filter(i =>
    ['flint', 'iron_ingot', 'raw_iron', 'flint_and_steel', 'leather'].includes(i.name)
  );
  console.log('Key items:', keyItems.map(i => `${i.name}x${i.count}`).join(', ') || 'none');

  bot.end();
});

bot.on('error', e => { console.error('Bot error:', e.message); process.exit(1); });
bot.on('end', () => { process.exit(0); });
