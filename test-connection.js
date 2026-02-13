import mineflayer from 'mineflayer';

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'TestBot',
});

bot.once('spawn', () => {
  console.log('✓ Successfully connected and spawned!');
  bot.quit();
  process.exit(0);
});

bot.once('error', (err) => {
  console.error('✗ Connection error:', err.message);
  process.exit(1);
});

bot.once('kicked', (reason) => {
  console.error('✗ Kicked from server:', reason);
  process.exit(1);
});

bot.once('end', (reason) => {
  console.error('✗ Connection ended:', reason);
  process.exit(1);
});

setTimeout(() => {
  console.error('✗ Connection timeout after 10 seconds');
  process.exit(1);
}, 10000);
