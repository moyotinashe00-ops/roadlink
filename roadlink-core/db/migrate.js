// Usage: node db/migrate.js [--seed]
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');
const config = require('../src/config');
const { seed } = require('./seed');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('[migrate] schema applied');
    if (process.argv.includes('--seed')) {
      if (config.env === 'production') throw new Error('Refusing to seed demo accounts in production.');
      await seed(pool, config.seedPassword);
      console.log(`[migrate] demo data seeded (demo accounts use SEED_PASSWORD)`);
    }
  } catch (err) {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
