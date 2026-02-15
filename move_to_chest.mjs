import { getActiveBots } from './dist/bot-manager.js';
import { Vec3 } from 'vec3';

const bots = getActiveBots();
const managed = bots.find(b => b.username === 'Claude5');
if (!managed) {
  console.log('Bot not found');
  process.exit(1);
}

const bot = managed.bot;

// Walk to the chest position
bot.pathfinder.setGoal(null);
await new Promise(r => setTimeout(r, 100));

// Use GoalBlock to stand exactly at (-80, 80, -53)
const pkg = await import('mineflayer-pathfinder');
const { goals } = pkg.default;
const goal = new goals.GoalNear(-80, 80, -53, 1);
bot.pathfinder.setGoal(goal);

// Wait for arrival
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 200));
  const dist = bot.entity.position.distanceTo(new Vec3(-80, 80, -53));
  if (dist < 2) {
    console.log('Arrived at chest position');
    break;
  }
}

console.log('Current position:', bot.entity.position);
bot.pathfinder.setGoal(null);

// Now try to open the chest at (-80, 80, -53)
const targetPos = new Vec3(-80, 80, -53);
const block = bot.blockAt(targetPos);
console.log('Block at (-80, 80, -53):', block ? block.name : 'null');

if (block && block.name === 'chest') {
  try {
    const chest = await bot.openContainer(block);
    const items = chest.containerItems();
    console.log('\nChest at (-80, 80, -53):');
    if (items.length === 0) {
      console.log('  Empty');
    } else {
      items.forEach(item => {
        console.log(`  ${item.name} x${item.count}`);
      });
    }
    
    // Try to take obsidian
    const obsidian = items.find(i => i.name === 'obsidian');
    if (obsidian) {
      await chest.withdraw(obsidian.type, null, obsidian.count);
      console.log(`Took ${obsidian.count} obsidian`);
    }
    
    chest.close();
  } catch (err) {
    console.log('Error:', err.message);
  }
}

process.exit(0);
