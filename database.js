const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDriverTables() {
  const client = await pool.connect();
  try {
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_trips (
        id SERIAL PRIMARY KEY,
        driver_phone TEXT NOT NULL,
        driver_name  TEXT,
        route_date   TEXT NOT NULL,
        route_number INTEGER NOT NULL,
        started_at   TEXT,
        ended_at     TEXT,
        status       TEXT DEFAULT 'not_started',
        UNIQUE(driver_phone, route_date, route_number)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_stop_notes (
        id SERIAL PRIMARY KEY,
        driver_phone TEXT NOT NULL,
        driver_name  TEXT,
        route_date   TEXT NOT NULL,
        route_number INTEGER NOT NULL,
        stop_index   INTEGER NOT NULL,
        stop_name    TEXT,
        note         TEXT NOT NULL,
        created_at   TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS driver_skipped_stops (
        id SERIAL PRIMARY KEY,
        driver_phone TEXT NOT NULL,
        driver_name  TEXT,
        route_date   TEXT NOT NULL,
        route_number INTEGER NOT NULL,
        stop_index   INTEGER NOT NULL,
        stop_name    TEXT,
        reason       TEXT,
        skipped_at   TEXT NOT NULL,
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
