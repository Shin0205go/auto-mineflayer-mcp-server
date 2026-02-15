import { getBotByUsername } from './dist/bot-manager.js';
import { Vec3 } from 'vec3';

const managed = getBotByUsername('Claude5');
if (!managed) {
  console.log('Bot not found');
  process.exit(1);
}

const bot = managed.bot;
console.log('Current position:', bot.entity.position);

// Check the specific chest at (-80, 80, -53)
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
    chest.close();
  } catch (err) {
    console.log('Error:', err.message);
  }
}

process.exit(0);
