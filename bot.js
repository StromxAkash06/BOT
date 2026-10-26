/**
 * Minecraft Multi-Server AFK Bot
 * Connects to 2+ servers simultaneously
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

if (!config.servers || !Array.isArray(config.servers) || config.servers.length === 0) {
  console.error('❌ config.json must have "servers" array with at least one server.');
  process.exit(1);
}

// ── Logging helper ──
function log(tag, msg) {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[${time}] [${tag}] ${msg}`);
}

// ── Bot class per server ──
class ServerBot {
  constructor(cfg) {
    this.cfg = cfg;
    this.tag = cfg.name || cfg.host;
    this.bot = null;
    this.reconnectTimer = null;
    this.moveTimer = null;
    this.chatTimer = null;
    this.isShuttingDown = false;
  }

  createBot() {
    if (this.isShuttingDown) return;

    log(this.tag, `🔌 Connecting to ${this.cfg.host}:${this.cfg.port} as ${this.cfg.username}...`);

    try {
      this.bot = mineflayer.createBot({
        host: this.cfg.host,
        port: this.cfg.port,
        username: this.cfg.username,
        password: this.cfg.password || undefined,
        auth: this.cfg.auth || 'offline',
        version: this.cfg.version || false,
        hideErrors: false,
        closeTimeout: 60000,
        checkTimeoutInterval: 60000
      });
    } catch (err) {
      log(this.tag, '❌ Failed to create bot: ' + err.message);
      this.scheduleReconnect();
      return;
    }

    // ── Spawn ──
    this.bot.once('spawn', () => {
      log(this.tag, '✅ Bot spawned!');
      setTimeout(() => {
        this.startAntiAFK();
        this.startRandomChat();
      }, config.spawnWarmup || 5000);
    });

    // ── Kicked ──
    this.bot.on('kicked', (reason) => {
      let r = reason;
      try { r = typeof reason === 'string' ? reason : JSON.stringify(reason); } catch (_) {}
      log(this.tag, '⚠️  Kicked: ' + r);
      this.scheduleReconnect();
    });

    // ── Error ──
    this.bot.on('error', (err) => {
      log(this.tag, '❌ Error: ' + (err && err.message ? err.message : err));
    });

    // ── Disconnect ──
    this.bot.on('end', (reason) => {
      log(this.tag, '🔌 Disconnected: ' + (reason || 'unknown'));
      this.stopAntiAFK();
      this.stopRandomChat();
      this.scheduleReconnect();
    });

    // ── Chat ──
    if (config.chatLogging) {
      this.bot.on('chat', (username, message) => {
        if (username === this.bot.username) return;
        log(this.tag, `💬 [Chat] ${username}: ${message}`);
      });
    }

    // ── Login ──
    this.bot.on('login', () => {
      log(this.tag, '🔑 Logged in.');
    });
  }

  scheduleReconnect() {
    if (this.isShuttingDown) return;
    if (this.reconnectTimer) return;

    const delay = config.reconnectDelay || 10000;
    log(this.tag, `⏳ Reconnecting in ${delay / 1000}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createBot();
    }, delay);
  }

  startAntiAFK() {
    this.stopAntiAFK();

    const min = config.moveIntervalMin || 5000;
    const max = config.moveIntervalMax || 10000;

    const loop = () => {
      if (!this.bot || !this.bot.entity) return;

      try {
        const actions = ['forward', 'back', 'left', 'right', 'jump'];
        const action = actions[Math.floor(Math.random() * actions.length)];

        this.bot.setControlState(action, true);
        setTimeout(() => {
          if (this.bot && this.bot.entity) {
            this.bot.setControlState(action, false);
          }
        }, 800 + Math.random() * 800);

        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * (Math.PI / 3);
        this.bot.look(yaw, pitch, false).catch(() => {});

        log(this.tag, `🏃 Action: ${action}`);
      } catch (err) {
        log(this.tag, '⚠️  Movement error: ' + err.message);
      }

      const nextDelay = min + Math.random() * (max - min);
      this.moveTimer = setTimeout(loop, nextDelay);
    };

    this.moveTimer = setTimeout(loop, min);
    log(this.tag, '🚀 Anti-AFK started.');
  }

  stopAntiAFK() {
    if (this.moveTimer) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
  }

  startRandomChat() {
    this.stopRandomChat();

    if (!config.randomChatEnabled) return;
    if (!config.chatMessages || config.chatMessages.length === 0) return;

    const min = config.randomChatIntervalMin || 80000;
    const max = config.randomChatIntervalMax || 90000;

    const loop = () => {
      if (!this.bot || !this.bot.entity) return;

      try {
        const msgs = config.chatMessages;
        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        this.bot.chat(msg);
        log(this.tag, `💬 [Random Chat] Sent: ${msg}`);
      } catch (err) {
        log(this.tag, '⚠️  Chat error: ' + err.message);
      }

      const nextDelay = min + Math.random() * (max - min);
      this.chatTimer = setTimeout(loop, nextDelay);
    };

    const firstDelay = min + Math.random() * (max - min);
    this.chatTimer = setTimeout(loop, firstDelay);
    log(this.tag, `🚀 Random chat started (${min / 1000}-${max / 1000}s).`);
  }

  stopRandomChat() {
    if (this.chatTimer) {
      clearTimeout(this.chatTimer);
      this.chatTimer = null;
    }
  }

  shutdown(signal) {
    log(this.tag, `🛑 ${signal} — shutting down`);
    this.isShuttingDown = true;
    this.stopAntiAFK();
    this.stopRandomChat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.bot) {
      try { this.bot.quit('Shutting down'); } catch (_) {}
    }
  }
}

// ── Create all bots ──
const bots = config.servers.map((cfg, i) => {
  log('MAIN', `📋 Server ${i + 1}: ${cfg.name || cfg.host}`);
  return new ServerBot(cfg);
});

// ── Health server ──
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  const status = bots.map(b => ({
    server: b.tag,
    connected: !!(b.bot && b.bot.entity),
    username: b.cfg.username
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ bots: status, uptime: process.uptime() }, null, 2));
}).listen(PORT, () => {
  log('MAIN', `🌐 Health server on port ${PORT}`);
});

// ── Graceful shutdown ──
function shutdownAll(signal) {
  log('MAIN', `🛑 ${signal} received, shutting down all bots...`);
  bots.forEach(b => b.shutdown(signal));
  setTimeout(() => process.exit(0), 2000);
}

process.on('SIGINT', () => shutdownAll('SIGINT'));
process.on('SIGTERM', () => shutdownAll('SIGTERM'));
process.on('uncaughtException', (err) => {
  log('MAIN', '💥 Uncaught: ' + err.message);
});
process.on('unhandledRejection', (reason) => {
  log('MAIN', '💥 Unhandled rejection: ' + reason);
});

// ── Start all bots ──
log('MAIN', '═══════════════════════════════════════');
log('MAIN', `  Multi-Server AFK Bot — ${bots.length} servers`);
log('MAIN', '═══════════════════════════════════════');
bots.forEach(b => b.createBot());
