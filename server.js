const express = require('express');
const cors    = require('cors');
const path    = require('path');
const pool    = require('./database');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// ── GET /api/driver/profile?phone=xxx ─────────────────────────────────────
app.get('/api/driver/profile', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const r = await pool.query(
      `SELECT DISTINCT driver_name, driver_phone FROM operations WHERE driver_phone=$1 LIMIT 1`,
      [phone]
    );
    if (!r.rows.length) return res.json({ found: false });
    res.json({ found: true, driver: { name: r.rows[0].driver_name, phone: r.rows[0].driver_phone } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/driver/routes?phone=xxx&date=yyyy-mm-dd ──────────────────────
app.get('/api/driver/routes', async (req, res) => {
  const { phone, date } = req.query;
  if (!phone || !date) return res.status(400).json({ error: 'phone and date required' });
  try {
    const ops = await pool.query(
      `SELECT * FROM operations WHERE driver_phone=$1 AND date=$2 ORDER BY route_number`,
      [phone, date]
    );
    if (!ops.rows.length) return res.json({ routes: [] });

    const vRes = await pool.query(`SELECT MAX(version) AS v FROM routes WHERE date=$1`, [date]);
    const latestVersion = vRes.rows[0]?.v;
    if (!latestVersion) return res.json({ routes: [] });

    const routes = [];
    for (const op of ops.rows) {
      const rRes = await pool.query(
        `SELECT * FROM routes WHERE date=$1 AND version=$2 AND route_number=$3`,
        [date, latestVersion, op.route_number]
      );
      if (!rRes.rows.length) continue;
      const route = rRes.rows[0];
      const stops = JSON.parse(route.stops_json || '[]');

      const [checkins, photos, trip, notes, skips] = await Promise.all([
        pool.query(`SELECT * FROM driver_checkins WHERE driver_phone=$1 AND route_date=$2 AND route_number=$3 ORDER BY stop_index`, [phone, date, op.route_number]),
        pool.query(`SELECT id, stop_index, stop_name, uploaded_at, photo_data FROM driver_photos WHERE driver_phone=$1 AND route_date=$2 AND route_number=$3 ORDER BY stop_index`, [phone, date, op.route_number]),
        pool.query(`SELECT * FROM driver_trips WHERE driver_phone=$1 AND route_date=$2 AND route_number=$3`, [phone, date, op.route_number]),
        pool.query(`SELECT * FROM driver_stop_notes WHERE driver_phone=$1 AND route_date=$2 AND route_number=$3 ORDER BY created_at`, [phone, date, op.route_number]),
        pool.query(`SELECT * FROM driver_skipped_stops WHERE driver_phone=$1 AND route_date=$2 AND route_number=$3`, [phone, date, op.route_number])
      ]);

      routes.push({
        ...route, stops,
        vehicle:        op.actual_vehicle || op.planned_vehicle || route.vehicle,
        vehicle_number: op.vehicle_number,
        driver_name:    op.driver_name,
        checkins:       checkins.rows,
        photos:         photos.rows,
        trip:           trip.rows[0] || null,
        notes:          notes.rows,
        skips:          skips.rows
      });
    }
    res.json({ routes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/driver/checkin ───────────────────────────────────────────────
app.post('/api/driver/checkin', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number, stop_index, stop_name, lat, lon, accuracy, type } = req.body;
  if (!driver_phone || !route_date || route_number == null || stop_index == null || lat == null || lon == null)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    await pool.query(
      `INSERT INTO driver_checkins (driver_phone,driver_name,route_date,route_number,stop_index,stop_name,lat,lon,accuracy,type,checked_in_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (driver_phone,route_date,route_number,stop_index)
       DO UPDATE SET lat=$7,lon=$8,accuracy=$9,checked_in_at=$11`,
      [driver_phone, driver_name, route_date, route_number, stop_index, stop_name, lat, lon, accuracy || null, type || 'stop', new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/driver/photo ─────────────────────────────────────────────────
app.post('/api/driver/photo', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number, stop_index, stop_name, photo_data } = req.body;
  if (!driver_phone || !route_date || route_number == null || stop_index == null || !photo_data)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    await pool.query(
      `INSERT INTO driver_photos (driver_phone,driver_name,route_date,route_number,stop_index,stop_name,photo_data,uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (driver_phone,route_date,route_number,stop_index)
       DO UPDATE SET photo_data=$7,uploaded_at=$8`,
      [driver_phone, driver_name, route_date, route_number, stop_index, stop_name, photo_data, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/driver/trip/start ────────────────────────────────────────────
app.post('/api/driver/trip/start', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number } = req.body;
  if (!driver_phone || !route_date || route_number == null)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    await pool.query(
      `INSERT INTO driver_trips (driver_phone,driver_name,route_date,route_number,started_at,status)
       VALUES ($1,$2,$3,$4,$5,'in_progress')
       ON CONFLICT (driver_phone,route_date,route_number)
       DO UPDATE SET started_at=$5, status='in_progress'`,
      [driver_phone, driver_name, route_date, route_number, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/driver/trip/end ──────────────────────────────────────────────
app.post('/api/driver/trip/end', async (req, res) => {
  const { driver_phone, route_date, route_number } = req.body;
  if (!driver_phone || !route_date || route_number == null)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    await pool.query(
      `INSERT INTO driver_trips (driver_phone,route_date,route_number,ended_at,status)
       VALUES ($1,$2,$3,$4,'completed')
       ON CONFLICT (driver_phone,route_date,route_number)
       DO UPDATE SET ended_at=$4, status='completed'`,
      [driver_phone, route_date, route_number, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/driver/note ──────────────────────────────────────────────────
app.post('/api/driver/note', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number, stop_index, stop_name, note } = req.body;
  if (!driver_phone || !route_date || route_number == null || stop_index == null || !note)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    await pool.query(
      `INSERT INTO driver_stop_notes (driver_phone,driver_name,route_date,route_number,stop_index,stop_name,note,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [driver_phone, driver_name, route_date, route_number, stop_index, stop_name, note, new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/driver/skip ──────────────────────────────────────────────────
app.post('/api/driver/skip', async (req, res) => {
  const { driver_phone, driver_name, route_date, route_number, stop_index, stop_name, reason } = req.body;
  if (!driver_phone || !route_date || route_number == null || stop_index == null)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    await pool.query(
      `INSERT INTO driver_skipped_stops (driver_phone,driver_name,route_date,route_number,stop_index,stop_name,reason,skipped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (driver_phone,route_date,route_number,stop_index)
       DO UPDATE SET reason=$7, skipped_at=$8`,
      [driver_phone, driver_name, route_date, route_number, stop_index, stop_name, reason || '', new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/driver/skip ────────────────────────────────────────────────
app.delete('/api/driver/skip', async (req, res) => {
  const { driver_phone, route_date, route_number, stop_index } = req.body;
  try {
    await pool.query(
      `DELETE FROM driver_skipped_stops WHERE driver_phone=$1 AND route_date=$2 AND route_number=$3 AND stop_index=$4`,
      [driver_phone, route_date, route_number, stop_index]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/driver/checkins/:date ────────────────────────────────────────
app.get('/api/driver/checkins/:date', async (req, res) => {
  try {
    const [checkins, photos] = await Promise.all([
      pool.query(`SELECT * FROM driver_checkins WHERE route_date=$1 ORDER BY checked_in_at`, [req.params.date]),
      pool.query(`SELECT id,driver_phone,driver_name,route_date,route_number,stop_index,stop_name,uploaded_at FROM driver_photos WHERE route_date=$1`, [req.params.date])
    ]);
    res.json({ checkins: checkins.rows, photos: photos.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/admin/summary/:date ──────────────────────────────────────────
app.get('/api/admin/summary/:date', async (req, res) => {
  const { date } = req.params;
  try {
    const ops = await pool.query(
      `SELECT * FROM operations WHERE date=$1 ORDER BY route_number`, [date]
    );

    const vRes = await pool.query(`SELECT MAX(version) AS v FROM routes WHERE date=$1`, [date]);
    const latestVersion = vRes.rows[0]?.v;

    const summary = [];
    for (const op of ops.rows) {
      const [route, checkins, photos, trip, notes, skips] = await Promise.all([
        latestVersion ? pool.query(`SELECT route_number,vehicle,total_stops,total_distance,dispatch_time,return_time,stops_json FROM routes WHERE date=$1 AND version=$2 AND route_number=$3`, [date, latestVersion, op.route_number]) : { rows: [] },
        pool.query(`SELECT * FROM driver_checkins WHERE route_date=$1 AND route_number=$2 ORDER BY stop_index`, [date, op.route_number]),
        pool.query(`SELECT id,stop_index,stop_name,uploaded_at FROM driver_photos WHERE route_date=$1 AND route_number=$2`, [date, op.route_number]),
        pool.query(`SELECT * FROM driver_trips WHERE route_date=$1 AND route_number=$2`, [date, op.route_number]),
        pool.query(`SELECT * FROM driver_stop_notes WHERE route_date=$1 AND route_number=$2 ORDER BY created_at`, [date, op.route_number]),
        pool.query(`SELECT * FROM driver_skipped_stops WHERE route_date=$1 AND route_number=$2`, [date, op.route_number])
      ]);

      const routeData = route.rows[0] || {};
      const stops = routeData.stops_json ? JSON.parse(routeData.stops_json) : [];

      summary.push({
        route_number:    op.route_number,
        driver_name:     op.driver_name || '—',
        driver_phone:    op.driver_phone || '—',
        vehicle:         op.actual_vehicle || op.planned_vehicle || '—',
        vehicle_number:  op.vehicle_number || '—',
        planned_dispatch: op.planned_dispatch,
        total_stops:     stops.length > 0 ? stops.length - 1 : 0,
        total_distance:  routeData.total_distance,
        checkins:        checkins.rows,
        photos:          photos.rows,
        trip:            trip.rows[0] || null,
        notes:           notes.rows,
        skips:           skips.rows
      });
    }
    res.json({ date, summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Urban Harvest Driver App running on port ${PORT}\n`);
});
