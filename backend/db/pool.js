const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] FATAL ERROR: DATABASE_URL environment variable is required.');
  console.error('[DB] Please configure your PostgreSQL connection string.');
  process.exit(1);
}

// Enforcing strict SSL configuration specifically tailored for Supabase, Render, Neon, etc.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('[DB] Connected to PostgreSQL instance');

module.exports = pool;
