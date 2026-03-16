/**
 * Check if blocks are dropping items (gamerule issue?)
 * Also find iron ore near y=50-70 range
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
async function goNear(x, y, z, dist = 2, t = 20000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, t);
    bot.pathfinder.setGoal(new GoalNear(x, y, z, dist));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
}

bot.once('spawn', async () => {
  await sleep(1500);
  console.log('Pos:', bot.entity.position, 'HP:', bot.health);

  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true;
  bot.pathfinder.setMovements(movements);

  // Check inventory first
  const inv = bot.inventory.items();
  console.log('Inventory summary:');
  inv.forEach(i => console.log(` ${i.name} x${i.count}`));

  // Look for iron ore from current y=67
  console.log('\n=== Searching for iron ore from current position ===');
  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    if (!id) { console.log(oreName, 'id not found'); continue; }
    const found = bot.findBlocks({ matching: id, maxDistance: 30, count: 10 });
    if (found.length > 0) {
      console.log(oreName + ':', found.length, 'blocks nearby');
      found.slice(0, 3).forEach(p => console.log(` (${p.x},${p.y},${p.z})`));
    }
  }

  // Mine stone nearby to test drops (stone should drop cobblestone)
  const stoneBlock = bot.findBlock({
    matching: b => b.name === 'stone' || b.name === 'cobblestone',
    maxDistance: 10
  });
  if (stoneBlock) {
    const invBefore = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
    console.log('\nMining stone to test drops. Cobblestone before:', invBefore);
    const pick = bot.inventory.items().find(i => i.name.includes('pickaxe'));
    if (pick) await bot.equip(pick, 'hand');
    await bot.dig(stoneBlock);
    await sleep(500);
    const invAfter = bot.inventory.items().find(i => i.name === 'cobblestone')?.count || 0;
    console.log('Cobblestone after:', invAfter, '(diff:', invAfter - invBefore, ')');
    if (invAfter > invBefore) {
      console.log('DROPS WORKING! Stone dropped cobblestone.');
    } else {
      console.log('WARNING: Stone did NOT drop cobblestone - drops may be disabled!');
    }
  }

  // Try to mine deep - navigate down in stages
  console.log('\n=== Navigating down to y=50 for iron ore ===');
  const x = Math.round(bot.entity.position.x);
  const z = Math.round(bot.entity.position.z);

  // Stage 1: y=67 -> y=55
  console.log('Stage 1: going to', x, 55, z);
  await goNear(x, 55, z, 3, 20000);
  console.log('At:', bot.entity.position);

  // Check iron ore
  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    const found = bot.findBlocks({ matching: id, maxDistance: 20, count: 5 });
    if (found.length > 0) {
      console.log(oreName + ' at y=55 area:', found.length, 'blocks');
      found.forEach(p => console.log(` (${p.x},${p.y},${p.z})`));
    }
  }

  // Mine iron ore if found nearby
  for (const oreName of ['iron_ore', 'deepslate_iron_ore']) {
    const id = bot.registry.blocksByName[oreName]?.id;
    const foundBlock = bot.findBlock({ matching: id, maxDistance: 20 });
    if (foundBlock) {
      console.log('\nMining', oreName, 'at', foundBlock.position);
      const rawBefore = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;
      await goNear(foundBlock.position.x, foundBlock.position.y, foundBlock.position.z, 2, 15000);
      const pick = bot.inventory.items().find(i => i.name.includes('pickaxe'));
      if (pick) await bot.equip(pick, 'hand');

      const closeOre = bot.findBlock({ matching: id, maxDistance: 5 });
      if (closeOre) {
        await bot.dig(closeOre);
        await sleep(500);
        const rawAfter = bot.inventory.items().find(i => i.name === 'raw_iron')?.count || 0;
        console.log('Raw iron: before', rawBefore, 'after', rawAfter, 'diff', rawAfter - rawBefore);
      }
      break;
    }
  }

  const rawIron = bot.inventory.items().find(i => i.name === 'raw_iron');
  const flint = bot.inventory.items().find(i => i.name === 'flint');
  console.log('\nRaw iron:', rawIron ? rawIron.count : 0);
  console.log('Flint:', flint ? flint.count : 0);
  console.log('HP:', bot.health, 'at', bot.entity.position);

  bot.end();
});

bot.on('error', e => { console.error('Error:', e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
