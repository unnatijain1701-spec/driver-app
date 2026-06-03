const express = require('express');
const cors    = require('cors');
const path    = require('path');
const pool    = require('./database');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// ── GET /api/driver/profile?phone=xxx ──────────────────────────────────────
// Verify driver exists in operations; return name + phone
app.get('/api/driver/profile', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const r = await pool.query(
      `SELECT DISTINCT driver_name, driver_phone
       FROM operations WHERE driver_phone = $1 LIMIT 1`,
      [phone]
    );
    if (!r.rows.length) return res.json({ found: false });
    res.json({ found: true, driver: { name: r.rows[0].driver_name, phone: r.rows[0].driver_phone } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/driver/routes?phone=xxx&date=yyyy-mm-dd ──────────────────────
// Return all routes assigned to this driver for the given date,
// including their checkins and photos so the frontend can show progress.
app.get('/api/driver/routes', async (req, res) => {
  const { phone, date } = req.query;
  if (!phone || !date) return res.status(400).json({ error: 'phone and date required' });
  try {
    const ops = await pool.query(
      `SELECT * FROM operations
       WHERE driver_phone = $1 AND date = $2
       ORDER BY route_number`,
      [phone, date]
    );
    if (!ops.rows.length) return res.json({ routes: [] });

    // Latest saved version for this date
    const vRes = await pool.query(
      `SELECT MAX(version) AS v FROM routes WHERE date = $1`, [date]
    );
    const latestVersion = vRes.rows[0]?.v;
    if (!latestVersion) return res.json({ routes: [] });

    const routes = [];
    for (const op of ops.rows) {
      const rRes = await pool.query(
        `SELECT * FROM routes
         WHERE date = $1 AND version = $2 AND route_number = $3`,
        [date, latestVersion, op.route_number]
      );
      if (!rRes.rows.length) continue;

      const route  = rRes.rows[0];
      const stops  = JSON.parse(route.stops_json || '[]');

      const checkins = await pool.query(
        `SELECT * FROM driver_checkins
         WHERE driver_phone = $1 AND route_date = $2 AND route_number = $3
         ORDER BY stop_index`,
        [phone, date, op.route_number]
      );
      const photos = await pool.query(
        `SELECT id, stop_index, stop_name, uploaded_at, photo_data
         FROM driver_photos
         WHERE driver_phone = $1 AND route_date = $2 AND route_number = $3
         ORDER BY stop_index`,
        [phone, date, op.route_number]
      );

      routes.push({
        ...route,
        stops,
        // prefer actual vehicle info from operations row
        vehicle:        op.actual_vehicle || op.planned_vehicle || route.vehicle,
        vehicle_number: op.vehicle_number,
        driver_name:    op.driver_name,
        checkins:       checkins.rows,
        photos:         photos.rows
      });
    }

    res.json({ routes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/driver/checkin ───────────────────────────────────────────────
app.post('/api/driver/checkin', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number,
          stop_index, stop_name, lat, lon, accuracy, type } = req.body;

  if (!driver_phone || !route_date || route_number == null ||
      stop_index == null || lat == null || lon == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await pool.query(
      `INSERT INTO driver_checkins
         (driver_phone, driver_name, route_date, route_number,
          stop_index, stop_name, lat, lon, accuracy, type, checked_in_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (driver_phone, route_date, route_number, stop_index)
       DO UPDATE SET lat=$7, lon=$8, accuracy=$9, checked_in_at=$11`,
      [driver_phone, driver_name, route_date, route_number,
       stop_index, stop_name, lat, lon, accuracy || null,
       type || 'stop', new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/driver/photo ─────────────────────────────────────────────────
app.post('/api/driver/photo', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number,
          stop_index, stop_name, photo_data } = req.body;

  if (!driver_phone || !route_date || route_number == null ||
      stop_index == null || !photo_data) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await pool.query(
      `INSERT INTO driver_photos
         (driver_phone, driver_name, route_date, route_number,
          stop_index, stop_name, photo_data, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (driver_phone, route_date, route_number, stop_index)
       DO UPDATE SET photo_data=$7, uploaded_at=$8`,
      [driver_phone, driver_name, route_date, route_number,
       stop_index, stop_name, photo_data, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/driver/checkins/:date ────────────────────────────────────────
// Admin/planner endpoint: see all check-ins for a day
app.get('/api/driver/checkins/:date', async (req, res) => {
  try {
    const checkins = await pool.query(
      `SELECT * FROM driver_checkins WHERE route_date = $1 ORDER BY checked_in_at`,
      [req.params.date]
    );
    const photos = await pool.query(
      `SELECT id, driver_phone, driver_name, route_date, route_number,
              stop_index, stop_name, uploaded_at
       FROM driver_photos WHERE route_date = $1`,
      [req.params.date]
    );
    res.json({ checkins: checkins.rows, photos: photos.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Urban Harvest Driver App running on port ${PORT}\n`);
});
