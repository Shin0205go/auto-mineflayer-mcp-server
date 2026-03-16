/**
 * Check terrain around current position to understand navigation issues
 * Bot is at (-9, 100, -18) and can't navigate
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

bot.once('spawn', async () => {
  await sleep(2000);
  const pos = bot.entity.position;
  console.log('Pos:', pos, 'HP:', bot.health, 'Hunger:', bot.food);

  // Check blocks in a cross pattern around bot
  console.log('\n=== Terrain scan around bot ===');
  const scanRadius = 5;
  for (let dz = -scanRadius; dz <= scanRadius; dz += 2) {
    for (let dx = -scanRadius; dx <= scanRadius; dx += 2) {
      const x = Math.round(pos.x) + dx;
      const z = Math.round(pos.z) + dz;
      // Find ground height at this x,z
      for (let dy = 3; dy >= -5; dy--) {
        const y = Math.round(pos.y) + dy;
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block && block.name !== 'air') {
          const above = bot.blockAt(new Vec3(x, y + 1, z));
          if (!above || above.name === 'air') {
            // This is the surface
            console.log(`(${dx},${dz}): surface y=${y} block=${block.name}`);
            break;
          }
        }
      }
    }
  }

  // Check what's directly below
  console.log('\nDirectly below:');
  for (let dy = -1; dy >= -6; dy--) {
    const y = Math.round(pos.y) + dy;
    const block = bot.blockAt(new Vec3(Math.round(pos.x), y, Math.round(pos.z)));
    console.log(` y=${y}: ${block?.name || 'unknown'}`);
  }

  // Try navigating just 5 blocks in each direction
  console.log('\n=== Testing short navigation ===');
  const movements = new Movements(bot);
  movements.maxDropDown = 2;
  movements.canDig = true; // Allow digging for navigation
  bot.pathfinder.setMovements(movements);

  const dirs = [
    { name: 'N', x: 0, z: -5 },
    { name: 'S', x: 0, z: 5 },
    { name: 'E', x: 5, z: 0 },
    { name: 'W', x: -5, z: 0 },
  ];

  for (const dir of dirs) {
    const tx = Math.round(pos.x) + dir.x;
    const tz = Math.round(pos.z) + dir.z;
    const ty = Math.round(pos.y);

    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, 8000);
      bot.pathfinder.setGoal(new GoalNear(tx, ty, tz, 1));
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
      bot.once('path_update', (r) => {
        if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); }
        if (r.status === 'partialSuccess') { clearTimeout(timeout); resolve('partial'); }
      });
    });
    console.log(`${dir.name} (${tx},${ty},${tz}): ${result} -> pos=(${Math.round(bot.entity.position.x)},${Math.round(bot.entity.position.y)},${Math.round(bot.entity.position.z)})`);

    // Return to original
    await new Promise((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 8000);
      bot.pathfinder.setGoal(new GoalNear(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z), 1));
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
      bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve(); } });
    });
  }

  // Check if the bot is in a hole or enclosed space
  console.log('\nBlocks in 2x2 area around bot at current level:');
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const x = Math.round(pos.x) + dx;
      const y = Math.round(pos.y);
      const z = Math.round(pos.z) + dz;
      const block = bot.blockAt(new Vec3(x, y, z));
      if (block && block.name !== 'air') {
        console.log(` (${dx},${dz}): ${block.name}`);
      }
    }
  }

  // Navigate toward base (should always be reachable)
  console.log('\n=== Navigating to base at (8, 110, 8) ===');
  const r = await new Promise((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve('timeout'); }, 30000);
    bot.pathfinder.setGoal(new GoalNear(8, 110, 8, 5));
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve('reached'); });
    bot.once('path_update', (r) => { if (r.status === 'noPath') { clearTimeout(timeout); resolve('noPath'); } });
  });
  console.log('Base nav:', r, 'at', bot.entity.position);

  bot.end();
});

bot.on('error', e => { console.error(e.message); process.exit(1); });
bot.on('end', () => process.exit(0));
