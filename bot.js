/**
 * Minecraft 24/7 AFK Bot
 * Author: Kanha
 * Anti-AFK movement + auto-reconnect + random chat
 */

const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ── Load config ──
let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch (err) {
  console.error('❌ config.json not found or invalid:', err.message);
  process.exit(1);
}

// ── State ──
let bot;
let reconnectTimer = null;
let moveTimer = null;
let chatTimer = null;
let isShuttingDown = false;

// ── Logging helper ──
function log(msg) {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${time}] ${msg}`);
}

// ── Connect ──
function createBot() {
  if (isShuttingDown) return;

  log('🔌 Connecting to ' + config.host + ':' + config.port + ' as ' + config.username + '...');

  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password || undefined,
      auth: config.auth || 'offline',
      version: config.version || false,
      hideErrors: false,
      closeTimeout: 60000,
      checkTimeoutInterval: 60000
    });
  } catch (err) {
    log('❌ Failed to create bot: ' + err.message);
    scheduleReconnect();
    return;
  }

  // ── Spawn ──
  bot.once('spawn', () => {
    log('✅ Bot spawned in server!');
    setTimeout(() => {
      startAntiAFK();
      startRandomChat();
    }, config.spawnWarmup || 5000);
  });

  // ── Kicked ──
  bot.on('kicked', (reason) => {
    let r = reason;
    try {
      r = typeof reason === 'string' ? reason : JSON.stringify(reason);
    } catch (_) {}
    log('⚠️  Kicked: ' + r);
    scheduleReconnect();
  });

  // ── Error ──
  bot.on('error', (err) => {
    log('❌ Error: ' + (err && err.message ? err.message : err));
  });

  // ── Disconnect ──
  bot.on('end', (reason) => {
    log('🔌 Disconnected: ' + (reason || 'unknown'));
    stopAntiAFK();
    stopRandomChat();
    scheduleReconnect();
  });

  // ── Chat ──
  if (config.chatLogging) {
    bot.on('chat', (username, message) => {
      if (username === bot.username) return;
      log(`💬 [Chat] ${username}: ${message}`);

      if (config.autoChatReply && message.toLowerCase().includes(config.chatReplyTrigger)) {
        bot.chat(`${username}, ${config.chatReplyMessage}`);
      }
    });
  }

  // ── Login ──
  bot.on('login', () => {
    log('🔑 Logged in.');
  });
}

// ── Reconnect ──
function scheduleReconnect() {
  if (isShuttingDown) return;
  if (reconnectTimer) return;

  const delay = config.reconnectDelay || 10000;
  log(`⏳ Reconnecting in ${delay / 1000}s...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);
}

// ── Anti-AFK ──
function startAntiAFK() {
  stopAntiAFK();

  const min = config.moveIntervalMin || 5000;
  const max = config.moveIntervalMax || 10000;

  const loop = () => {
    if (!bot || !bot.entity) return;

    try {
      const actions = ['forward', 'back', 'left', 'right', 'jump'];
      const action = actions[Math.floor(Math.random() * actions.length)];

      bot.setControlState(action, true);
      setTimeout(() => {
        if (bot && bot.entity) {
          bot.setControlState(action, false);
        }
      }, 800 + Math.random() * 800);

      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * (Math.PI / 3);
      bot.look(yaw, pitch, false).catch(() => {});

      log(`🏃 Action: ${action}`);
    } catch (err) {
      log('⚠️  Movement error: ' + err.message);
    }

    const nextDelay = min + Math.random() * (max - min);
    moveTimer = setTimeout(loop, nextDelay);
  };

  moveTimer = setTimeout(loop, min);
  log('🚀 Anti-AFK started.');
}

function stopAntiAFK() {
  if (moveTimer) {
    clearTimeout(moveTimer);
    moveTimer = null;
  }
}

// ── Random Chat ──
function startRandomChat() {
  stopRandomChat();

  if (!config.randomChatEnabled) return;
  if (!config.chatMessages || config.chatMessages.length === 0) {
    log('⚠️  Random chat enabled but no messages configured.');
    return;
  }

  const min = config.randomChatIntervalMin || 80000;
  const max = config.randomChatIntervalMax || 90000;

  const loop = () => {
    if (!bot || !bot.entity) return;

    try {
      const msgs = config.chatMessages;
      const msg = msgs[Math.floor(Math.random() * msgs.length)];
      bot.chat(msg);
      log(`💬 [Random Chat] Sent: ${msg}`);
    } catch (err) {
      log('⚠️  Chat error: ' + err.message);
    }

    const nextDelay = min + Math.random() * (max - min);
    chatTimer = setTimeout(loop, nextDelay);
  };

  const firstDelay = min + Math.random() * (max - min);
  chatTimer = setTimeout(loop, firstDelay);
  log(`🚀 Random chat started (interval ${min / 1000}-${max / 1000}s).`);
}

function stopRandomChat() {
  if (chatTimer) {
    clearTimeout(chatTimer);
    chatTimer = null;
  }
}

// ── Health server (for Railway to keep container alive) ──
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MC AFK Bot is alive');
}).listen(PORT, () => {
  log(`🌐 Health server listening on port ${PORT}`);
});

// ── Graceful shutdown ──
function shutdown(signal) {
  log(`🛑 Received ${signal}. Shutting down...`);
  isShuttingDown = true;
  stopAntiAFK();
  stopRandomChat();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (bot) {
    try { bot.quit('Shutting down'); } catch (_) {}
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  log('💥 Uncaught exception: ' + err.message);
  log(err.stack);
});
process.on('unhandledRejection', (reason) => {
  log('💥 Unhandled rejection: ' + reason);
});

// ── Start ──
log('═══════════════════════════════════════');
log('  Minecraft 24/7 AFK Bot');
log('  Host: ' + config.host + ':' + config.port);
log('  User: ' + config.username);
log('  Auth: ' + config.auth);
log('  Random Chat: ' + (config.randomChatEnabled ? 'ON' : 'OFF'));
log('═══════════════════════════════════════');
createBot();
