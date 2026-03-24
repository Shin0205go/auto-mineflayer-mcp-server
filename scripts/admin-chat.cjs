// Admin bot: connect, send message, listen for replies, disconnect
const mineflayer = require('mineflayer');
const message = process.argv[2] || '';
const listenSec = parseInt(process.argv[3] || '5', 10);

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'admin',
  version: false
});

const chatLog = [];

bot.on('chat', (username, msg) => {
  if (username === 'admin') return;
  const line = `[${username}] ${msg}`;
  chatLog.push(line);
  console.log(line);
});

bot.once('spawn', () => {
  if (message) {
    const lines = message.split('\\n');
    let i = 0;
    const sendNext = () => {
      if (i < lines.length) {
        bot.chat(lines[i]);
        i++;
        setTimeout(sendNext, 500);
      } else {
        startListening();
      }
    };
    sendNext();
  } else {
    startListening();
  }
});

function startListening() {
  setTimeout(() => {
    if (chatLog.length === 0) {
      console.log('(no chat received)');
    }
    bot.quit();
    process.exit(0);
  }, listenSec * 1000);
}

bot.on('error', (err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Timeout');
  process.exit(1);
}, (listenSec + 20) * 1000);
