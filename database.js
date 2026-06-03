const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDriverTables() {
  const client = await pool.connect();
  try {
    // GPS check-ins: one row per driver per stop per route per date
    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_checkins (
        id SERIAL PRIMARY KEY,
        driver_phone TEXT NOT NULL,
        driver_name  TEXT,
        route_date   TEXT NOT NULL,
        route_number INTEGER NOT NULL,
        stop_index   INTEGER NOT NULL,
        stop_name    TEXT,
        lat          REAL NOT NULL,
        lon          REAL NOT NULL,
        accuracy     REAL,
        type         TEXT DEFAULT 'stop',
        checked_in_at TEXT NOT NULL,
        UNIQUE(driver_phone, route_date, route_number, stop_index)
      )
    `);

    // Temperature photos: base64-encoded JPEG, one per stop
    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_photos (
        id SERIAL PRIMARY KEY,
        driver_phone TEXT NOT NULL,
        driver_name  TEXT,
        route_date   TEXT NOT NULL,
        route_number INTEGER NOT NULL,
        stop_index   INTEGER NOT NULL,
        stop_name    TEXT,
        photo_data   TEXT NOT NULL,
        uploaded_at  TEXT NOT NULL,
        UNIQUE(driver_phone, route_date, route_number, stop_index)
      )
    `);

    console.log('✅ Driver tables ready');
  } finally {
    client.release();
  }
}

initDriverTables().catch(console.error);
module.exports = pool;
