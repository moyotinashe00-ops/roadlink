const http = require('http');
const config = require('./config');
const { pool } = require('./db');
const { createApp } = require('./app');
const { attach } = require('./realtime/socket');
const notifications = require('./services/notifications');

const server = http.createServer(createApp());
const io = attach(server);
notifications.init(io);

server.listen(config.port, () => {
  console.log(`[roadlink-core] listening on :${config.port} (${config.env})`);
});

function shutdown(signal) {
  console.log(`[roadlink-core] ${signal} received, shutting down`);
  io.close();
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
