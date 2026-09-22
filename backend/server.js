import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import dotenv from 'dotenv';
import { query, pool } from './db.js';
import { parseICS, isRealReservation } from './ical.js';
import { fetchAirbnbListing, extractListingId } from './scrape.js';
import { integrationStatus, fetchReservationsViaApi } from './integrations.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

if (JWT_SECRET === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') {
  console.warn('[server] WARNING: JWT_SECRET is using the insecure default in production.');
}

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EXPENSE_CATEGORIES = [
  'cleaning',
  'maintenance',
  'utilities',
  'supplies',
  'fees',
  'insurance',
  'other',
];

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Wrap async route handlers so rejections become 500s instead of crashing.
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`[${req.method} ${req.path}]`, err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Duplicate record' });
    }
    if (err.code === '42P01') {
      return res
        .status(500)
        .json({ error: 'Database not initialized. Run: npm run initdb' });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

function nights(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn);
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'property-mgmt-backend', time: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.post(
  '/api/auth/register',
  wrap(async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase(), hash, name || null]
    );
    const user = rows[0];
    res.status(201).json({ token: signToken(user), user });
  })
);

app.post(
  '/api/auth/login',
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const { rows } = await query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const safe = { id: user.id, email: user.email, name: user.name };
    res.json({ token: signToken(safe), user: safe });
  })
);

app.get(
  '/api/auth/me',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT id, email, name, company, brand_name, brand_color, mgmt_fee_pct, currency, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  })
);

// Update profile / white-label branding.
app.put(
  '/api/branding',
  auth,
  wrap(async (req, res) => {
    const fields = ['name', 'company', 'brand_name', 'brand_color', 'mgmt_fee_pct', 'currency'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.user.id);
    const { rows } = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, email, name, company, brand_name, brand_color, mgmt_fee_pct, currency`,
      vals
    );
    res.json(rows[0]);
  })
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------
app.get(
  '/api/properties',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM properties WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/properties',
  auth,
  wrap(async (req, res) => {
    const {
      name,
      address,
      city,
      country,
      bedrooms,
      bathrooms,
      max_guests,
      base_price,
      cleaning_fee,
      description,
      amenities,
      photos,
      airbnb_ical_url,
      vrbo_ical_url,
      booking_com_ical_url,
      airbnb_listing_id,
      notes,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      `INSERT INTO properties
        (user_id, name, address, city, country, bedrooms, bathrooms, max_guests, base_price, cleaning_fee,
         description, amenities, photos, airbnb_ical_url, vrbo_ical_url, booking_com_ical_url, airbnb_listing_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        req.user.id,
        name,
        address || null,
        city || null,
        country || null,
        bedrooms || 1,
        bathrooms || 1,
        max_guests || 2,
        base_price || 0,
        cleaning_fee || 0,
        description || null,
        amenities || null,
        photos || null,
        airbnb_ical_url || null,
        vrbo_ical_url || null,
        booking_com_ical_url || null,
        airbnb_listing_id || null,
        notes || null,
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/properties/:id',
  auth,
  wrap(async (req, res) => {
    const fields = [
      'name',
      'address',
      'city',
      'country',
      'bedrooms',
      'bathrooms',
      'max_guests',
      'base_price',
      'cleaning_fee',
      'description',
      'amenities',
      'photos',
      'airbnb_ical_url',
      'vrbo_ical_url',
      'booking_com_ical_url',
      'airbnb_listing_id',
      'wifi_name',
      'wifi_password',
      'checkin_time',
      'checkout_time',
      'house_rules',
      'guidebook',
      'notes',
    ];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE properties SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Property not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/properties/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM properties WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Property not found' });
    res.json({ deleted: true });
  })
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
app.get(
  '/api/bookings',
  auth,
  wrap(async (req, res) => {
    const { property_id, platform, status } = req.query;
    const clauses = ['b.user_id = $1'];
    const vals = [req.user.id];
    let i = 2;
    if (property_id) {
      clauses.push(`b.property_id = $${i++}`);
      vals.push(property_id);
    }
    if (platform) {
      clauses.push(`b.platform = $${i++}`);
      vals.push(platform);
    }
    if (status) {
      clauses.push(`b.status = $${i++}`);
      vals.push(status);
    }
    const { rows } = await query(
      `SELECT b.*, p.name AS property_name
         FROM bookings b
         JOIN properties p ON p.id = b.property_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY b.check_in DESC`,
      vals
    );
    res.json(rows);
  })
);

app.post(
  '/api/bookings',
  auth,
  wrap(async (req, res) => {
    const {
      property_id,
      guest_name,
      guest_email,
      platform,
      check_in,
      check_out,
      guests,
      total_amount,
      status,
    } = req.body || {};
    if (!property_id || !guest_name || !check_in || !check_out) {
      return res
        .status(400)
        .json({ error: 'property_id, guest_name, check_in and check_out are required' });
    }
    // Ensure the property belongs to this user (multi-tenant isolation).
    const owns = await query('SELECT id FROM properties WHERE id = $1 AND user_id = $2', [
      property_id,
      req.user.id,
    ]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Property not found' });

    const { rows } = await query(
      `INSERT INTO bookings
        (user_id, property_id, guest_name, guest_email, platform, check_in, check_out, guests, total_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.user.id,
        property_id,
        guest_name,
        guest_email || null,
        platform || 'direct',
        check_in,
        check_out,
        guests || 1,
        total_amount || 0,
        status || 'confirmed',
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/bookings/:id',
  auth,
  wrap(async (req, res) => {
    const fields = [
      'guest_name',
      'guest_email',
      'platform',
      'check_in',
      'check_out',
      'guests',
      'total_amount',
      'status',
    ];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/bookings/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM bookings WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Booking not found' });
    res.json({ deleted: true });
  })
);

// Generate a smart-lock door code for a reservation.
app.post(
  '/api/bookings/:id/lockcode',
  auth,
  wrap(async (req, res) => {
    const code = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
    const { rows } = await query(
      'UPDATE bookings SET door_code = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [code, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Booking not found' });
    res.json(rows[0]);
  })
);

// ---------------------------------------------------------------------------
// API credentials (Airbnb / VRBO)
// ---------------------------------------------------------------------------
app.get(
  '/api/credentials',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT platform, property_ref, created_at FROM api_credentials WHERE user_id = $1',
      [req.user.id]
    );
    res.json(rows); // never returns access_token
  })
);

async function saveCredential(req, res, platform) {
  const { property_ref, access_token } = req.body || {};
  if (!access_token) return res.status(400).json({ error: 'access_token is required' });
  const { rows } = await query(
    `INSERT INTO api_credentials (user_id, platform, property_ref, access_token)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, platform)
     DO UPDATE SET property_ref = EXCLUDED.property_ref, access_token = EXCLUDED.access_token
     RETURNING platform, property_ref, created_at`,
    [req.user.id, platform, property_ref || null, access_token]
  );
  res.json(rows[0]);
}

app.post('/api/credentials/airbnb', auth, wrap((req, res) => saveCredential(req, res, 'airbnb')));
app.post('/api/credentials/vrbo', auth, wrap((req, res) => saveCredential(req, res, 'vrbo')));

// ---------------------------------------------------------------------------
// Sync (Airbnb / VRBO)
//
// Airbnb and VRBO do not expose a public self-serve bookings API, so real
// syncing requires partner access. This implementation attempts a live fetch
// when a SYNC endpoint is configured, and otherwise falls back to generating
// a small set of sample reservations so the feature is demonstrable end to end.
// ---------------------------------------------------------------------------
async function fetchExternalBookings(platform, credential) {
  const endpoint =
    platform === 'airbnb'
      ? process.env.AIRBNB_SYNC_URL
      : process.env.VRBO_SYNC_URL;

  if (endpoint) {
    const { data } = await axios.get(endpoint, {
      headers: { Authorization: `Bearer ${credential.access_token}` },
      params: { property: credential.property_ref },
      timeout: 15000,
    });
    // Expect an array of { external_id, guest_name, guest_email, check_in, check_out, guests, total_amount }
    return Array.isArray(data) ? data : data.bookings || [];
  }

  // Demo fallback: deterministic sample reservations keyed off the platform.
  const today = new Date();
  const sample = [];
  const seeds = platform === 'airbnb' ? [3, 12, 25] : [7, 19];
  for (const offset of seeds) {
    const ci = new Date(today);
    ci.setDate(ci.getDate() + offset);
    const co = new Date(ci);
    co.setDate(co.getDate() + 3);
    sample.push({
      external_id: `${platform}-${offset}`,
      guest_name: `${platform === 'airbnb' ? 'Airbnb' : 'VRBO'} Guest ${offset}`,
      guest_email: null,
      check_in: ci.toISOString().slice(0, 10),
      check_out: co.toISOString().slice(0, 10),
      guests: 2,
      total_amount: 450 + offset * 10,
    });
  }
  return sample;
}

async function syncPlatform(req, res, platform) {
  const cred = await query(
    'SELECT * FROM api_credentials WHERE user_id = $1 AND platform = $2',
    [req.user.id, platform]
  );
  if (!cred.rows.length) {
    return res.status(400).json({ error: `No ${platform} credentials connected` });
  }

  // Pick the property to attach imported bookings to.
  const prop = await query(
    'SELECT id FROM properties WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
    [req.user.id]
  );
  if (!prop.rows.length) {
    return res.status(400).json({ error: 'Add a property before syncing bookings' });
  }
  const propertyId = prop.rows[0].id;

  const external = await fetchExternalBookings(platform, cred.rows[0]);
  let imported = 0;
  for (const b of external) {
    const result = await query(
      `INSERT INTO bookings
        (user_id, property_id, guest_name, guest_email, platform, external_id, check_in, check_out, guests, total_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
       ON CONFLICT (user_id, platform, external_id) WHERE external_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        req.user.id,
        propertyId,
        b.guest_name || 'Guest',
        b.guest_email || null,
        platform,
        b.external_id || null,
        b.check_in,
        b.check_out,
        b.guests || 1,
        b.total_amount || 0,
      ]
    );
    if (result.rows.length) imported += 1;
  }
  res.json({ platform, fetched: external.length, imported });
}

app.post('/api/sync/airbnb', auth, wrap((req, res) => syncPlatform(req, res, 'airbnb')));
app.post('/api/sync/vrbo', auth, wrap((req, res) => syncPlatform(req, res, 'vrbo')));

// ---------------------------------------------------------------------------
// iCal sync — the real, no-approval way to pull reservations from Airbnb/VRBO.
// Each listing exposes a private .ics URL (Availability -> Sync calendars).
// This fetches every property's calendar URLs, parses reservations, and imports
// them as bookings (dates only — Airbnb does not expose guest/payout via iCal).
// ---------------------------------------------------------------------------
async function importIcal(userId, property, platform, url) {
  const { data } = await axios.get(url, {
    timeout: 20000,
    responseType: 'text',
    headers: { 'User-Agent': 'PropManager/1.0' },
  });
  const events = parseICS(String(data)).filter(isRealReservation);
  let imported = 0;
  for (const ev of events) {
    const externalId = ev.uid || `${platform}-${ev.start}-${ev.end}`;
    const platformLabel =
      platform === 'airbnb' ? 'Airbnb' : platform === 'vrbo' ? 'VRBO' : 'Booking.com';
    const guestName =
      ev.summary && !/^(reserved|closed|not available|blocked)$/i.test(ev.summary)
        ? ev.summary
        : `${platformLabel} reservation`;
    const result = await query(
      `INSERT INTO bookings
        (user_id, property_id, guest_name, platform, external_id, check_in, check_out, guests, total_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,0,'confirmed')
       ON CONFLICT (user_id, platform, external_id) WHERE external_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [userId, property.id, guestName, platform, externalId, ev.start, ev.end]
    );
    if (result.rows.length) imported += 1;
  }
  return { fetched: events.length, imported };
}

app.post(
  '/api/sync/ical',
  auth,
  wrap(async (req, res) => {
    const { rows: props } = await query(
      'SELECT id, name, airbnb_ical_url, vrbo_ical_url, booking_com_ical_url FROM properties WHERE user_id = $1',
      [req.user.id]
    );
    const summary = [];
    let totalImported = 0;
    let totalFetched = 0;
    const errors = [];

    for (const p of props) {
      for (const [platform, url] of [
        ['airbnb', p.airbnb_ical_url],
        ['vrbo', p.vrbo_ical_url],
        ['booking', p.booking_com_ical_url],
      ]) {
        if (!url) continue;
        try {
          const r = await importIcal(req.user.id, p, platform, url);
          totalImported += r.imported;
          totalFetched += r.fetched;
          summary.push({ property: p.name, platform, ...r });
        } catch (err) {
          errors.push({ property: p.name, platform, error: err.message });
        }
      }
    }

    if (!summary.length && !errors.length) {
      return res.status(400).json({
        error: 'No calendar URLs configured. Add an Airbnb/VRBO iCal URL to a property first.',
      });
    }
    res.json({ fetched: totalFetched, imported: totalImported, detail: summary, errors });
  })
);

// ---------------------------------------------------------------------------
// Import listing content from the host's own PUBLIC Airbnb page
// ---------------------------------------------------------------------------
app.post(
  '/api/import/airbnb',
  auth,
  wrap(async (req, res) => {
    const listingId = extractListingId(req.body?.listing_id || req.body?.url);
    if (!listingId) {
      return res
        .status(400)
        .json({ error: 'Provide the Airbnb listing URL or ID (or set the iCal URL on the listing).' });
    }
    try {
      const data = await fetchAirbnbListing(listingId);
      // A real listing always has photos; anything else is a block/404/homepage.
      if (data.photos.length === 0) {
        return res.status(422).json({
          error:
            'Airbnb did not return the listing (it may be blocking automated requests or the listing is not public). Try again shortly, or add the content manually.',
        });
      }
      res.json({ listing_id: listingId, ...data });
    } catch (err) {
      if (err.response && (err.response.status === 404 || err.response.status === 410)) {
        return res
          .status(422)
          .json({ error: 'Listing not found or not public yet.' });
      }
      res.status(502).json({ error: `Could not reach Airbnb (${err.message}).` });
    }
  })
);

// ---------------------------------------------------------------------------
// Official OTA integrations — status + partner-API sync (when configured)
// ---------------------------------------------------------------------------
app.get('/api/integrations', auth, (req, res) => res.json({ integrations: integrationStatus() }));

app.post(
  '/api/integrations/:platform/sync',
  auth,
  wrap(async (req, res) => {
    const platform = req.params.platform;
    // Attach imported reservations to the user's first property (or a named one).
    const prop = await query(
      'SELECT id FROM properties WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [req.user.id]
    );
    if (!prop.rows.length) return res.status(400).json({ error: 'Add a property before syncing.' });
    try {
      const external = await fetchReservationsViaApi(platform);
      let imported = 0;
      for (const b of external) {
        const result = await query(
          `INSERT INTO bookings
            (user_id, property_id, guest_name, guest_email, platform, external_id, check_in, check_out, guests, total_amount, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
           ON CONFLICT (user_id, platform, external_id) WHERE external_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [req.user.id, prop.rows[0].id, b.guest_name, b.guest_email, platform, b.external_id, b.check_in, b.check_out, b.guests, b.total_amount]
        );
        if (result.rows.length) imported += 1;
      }
      res.json({ platform, fetched: external.length, imported });
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') return res.status(400).json({ error: err.message });
      throw err;
    }
  })
);

// ---------------------------------------------------------------------------
// Channel manager — per-listing channel connections & double-booking guard
// ---------------------------------------------------------------------------
app.get(
  '/api/channels',
  auth,
  wrap(async (req, res) => {
    const props = await query(
      `SELECT id, name, airbnb_ical_url, vrbo_ical_url, booking_com_ical_url, airbnb_listing_id
         FROM properties WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    const bookings = await query(
      `SELECT property_id, platform, COUNT(*)::int AS n
         FROM bookings WHERE user_id = $1 AND status <> 'cancelled'
        GROUP BY property_id, platform`,
      [req.user.id]
    );
    const countFor = (pid, platform) =>
      bookings.rows.find((b) => b.property_id === pid && b.platform === platform)?.n || 0;

    const listings = props.rows.map((p) => ({
      id: p.id,
      name: p.name,
      channels: [
        { key: 'airbnb', label: 'Airbnb', connected: !!p.airbnb_ical_url, reservations: countFor(p.id, 'airbnb') },
        { key: 'vrbo', label: 'VRBO', connected: !!p.vrbo_ical_url, reservations: countFor(p.id, 'vrbo') },
        { key: 'booking', label: 'Booking.com', connected: !!p.booking_com_ical_url, reservations: countFor(p.id, 'booking') },
        { key: 'direct', label: 'Direct', connected: true, reservations: countFor(p.id, 'direct') },
      ],
    }));

    const totalConnections = listings.reduce(
      (s, l) => s + l.channels.filter((c) => c.connected && c.key !== 'direct').length,
      0
    );
    res.json({ listings, totalConnections });
  })
);

// Detect overlapping (double-booked) reservations per property across channels.
app.get(
  '/api/conflicts',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT b.id, b.property_id, b.guest_name, b.platform, b.check_in, b.check_out, p.name AS property_name
         FROM bookings b JOIN properties p ON p.id = b.property_id
        WHERE b.user_id = $1 AND b.status <> 'cancelled'
        ORDER BY b.property_id, b.check_in`,
      [req.user.id]
    );
    const overlaps = (a, b) =>
      new Date(a.check_in) < new Date(b.check_out) &&
      new Date(b.check_in) < new Date(a.check_out);

    const conflicts = [];
    const byProp = {};
    for (const r of rows) (byProp[r.property_id] ||= []).push(r);
    for (const list of Object.values(byProp)) {
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          if (overlaps(list[i], list[j])) {
            conflicts.push({
              property_name: list[i].property_name,
              a: { guest: list[i].guest_name, platform: list[i].platform, check_in: list[i].check_in, check_out: list[i].check_out },
              b: { guest: list[j].guest_name, platform: list[j].platform, check_in: list[j].check_in, check_out: list[j].check_out },
            });
          }
        }
      }
    }
    res.json({ conflicts });
  })
);

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------
app.get(
  '/api/pricing',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT pr.*, p.name AS property_name
         FROM pricing_rules pr
         JOIN properties p ON p.id = pr.property_id
        WHERE pr.user_id = $1
        ORDER BY pr.start_date NULLS LAST`,
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/pricing',
  auth,
  wrap(async (req, res) => {
    const { property_id, name, start_date, end_date, price, min_stay } = req.body || {};
    if (!property_id || !name || price === undefined) {
      return res.status(400).json({ error: 'property_id, name and price are required' });
    }
    const owns = await query('SELECT id FROM properties WHERE id = $1 AND user_id = $2', [
      property_id,
      req.user.id,
    ]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Property not found' });
    const { rows } = await query(
      `INSERT INTO pricing_rules (user_id, property_id, name, start_date, end_date, price, min_stay)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, property_id, name, start_date || null, end_date || null, price, min_stay || 1]
    );
    res.status(201).json(rows[0]);
  })
);

app.delete(
  '/api/pricing/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM pricing_rules WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Pricing rule not found' });
    res.json({ deleted: true });
  })
);

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
app.get(
  '/api/expenses',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT e.*, p.name AS property_name
         FROM expenses e
         LEFT JOIN properties p ON p.id = e.property_id
        WHERE e.user_id = $1
        ORDER BY e.spent_on DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/expenses',
  auth,
  wrap(async (req, res) => {
    const { property_id, category, description, amount, spent_on, receipt_url } = req.body || {};
    if (!category || amount === undefined) {
      return res.status(400).json({ error: 'category and amount are required' });
    }
    if (!EXPENSE_CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ error: `category must be one of: ${EXPENSE_CATEGORIES.join(', ')}` });
    }
    const { rows } = await query(
      `INSERT INTO expenses (user_id, property_id, category, description, amount, spent_on, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.user.id,
        property_id || null,
        category,
        description || null,
        amount,
        spent_on || new Date().toISOString().slice(0, 10),
        receipt_url || null,
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.delete(
  '/api/expenses/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Expense not found' });
    res.json({ deleted: true });
  })
);

app.get('/api/expenses/categories', auth, (req, res) => res.json(EXPENSE_CATEGORIES));

// ---------------------------------------------------------------------------
// Messages (guest communication)
// ---------------------------------------------------------------------------
app.get(
  '/api/messages',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT m.*, p.name AS property_name
         FROM messages m
         LEFT JOIN properties p ON p.id = m.property_id
        WHERE m.user_id = $1
        ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/messages',
  auth,
  wrap(async (req, res) => {
    const { property_id, booking_id, guest_name, platform, direction, body } = req.body || {};
    if (!body) return res.status(400).json({ error: 'body is required' });
    const { rows } = await query(
      `INSERT INTO messages (user_id, property_id, booking_id, guest_name, platform, direction, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.user.id,
        property_id || null,
        booking_id || null,
        guest_name || null,
        platform || 'direct',
        direction === 'outgoing' ? 'outgoing' : 'incoming',
        body,
      ]
    );
    res.status(201).json(rows[0]);
  })
);

// ---------------------------------------------------------------------------
// Message templates & automation rules
// ---------------------------------------------------------------------------
const TEMPLATE_TRIGGERS = ['manual', 'booking_confirmed', 'before_checkin', 'after_checkout'];

app.get(
  '/api/templates',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT * FROM message_templates WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/templates',
  auth,
  wrap(async (req, res) => {
    const { name, body, trigger, active } = req.body || {};
    if (!name || !body) return res.status(400).json({ error: 'name and body are required' });
    const trg = TEMPLATE_TRIGGERS.includes(trigger) ? trigger : 'manual';
    const { rows } = await query(
      `INSERT INTO message_templates (user_id, name, body, trigger, active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, name, body, trg, active !== false]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/templates/:id',
  auth,
  wrap(async (req, res) => {
    const fields = ['name', 'body', 'trigger', 'active'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE message_templates SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/templates/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM message_templates WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Template not found' });
    res.json({ deleted: true });
  })
);

// ---------------------------------------------------------------------------
// Tasks (turnovers, maintenance)
// ---------------------------------------------------------------------------
app.get(
  '/api/tasks',
  auth,
  wrap(async (req, res) => {
    const { status } = req.query;
    const clauses = ['t.user_id = $1'];
    const vals = [req.user.id];
    if (status) {
      clauses.push('t.status = $2');
      vals.push(status);
    }
    const { rows } = await query(
      `SELECT t.*, p.name AS property_name
         FROM tasks t
         LEFT JOIN properties p ON p.id = t.property_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY t.due_date NULLS LAST, t.created_at DESC`,
      vals
    );
    res.json(rows);
  })
);

app.post(
  '/api/tasks',
  auth,
  wrap(async (req, res) => {
    const { property_id, booking_id, title, type, assignee, due_date, notes, status } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const { rows } = await query(
      `INSERT INTO tasks (user_id, property_id, booking_id, title, type, assignee, due_date, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        req.user.id,
        property_id || null,
        booking_id || null,
        title,
        type || 'cleaning',
        assignee || null,
        due_date || null,
        notes || null,
        status || 'open',
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/tasks/:id',
  auth,
  wrap(async (req, res) => {
    const fields = ['property_id', 'title', 'type', 'assignee', 'due_date', 'notes', 'status'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/tasks/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Task not found' });
    res.json({ deleted: true });
  })
);

// Auto-generate cleaning turnovers from upcoming check-outs.
app.post(
  '/api/tasks/generate-turnovers',
  auth,
  wrap(async (req, res) => {
    const { rows: bookings } = await query(
      `SELECT b.id, b.property_id, b.check_out, b.guest_name, p.name AS property_name
         FROM bookings b JOIN properties p ON p.id = b.property_id
        WHERE b.user_id = $1 AND b.status <> 'cancelled' AND b.check_out >= CURRENT_DATE`,
      [req.user.id]
    );
    let created = 0;
    for (const b of bookings) {
      const exists = await query(
        `SELECT id FROM tasks WHERE user_id = $1 AND booking_id = $2 AND type = 'cleaning'`,
        [req.user.id, b.id]
      );
      if (exists.rows.length) continue;
      await query(
        `INSERT INTO tasks (user_id, property_id, booking_id, title, type, due_date, status)
         VALUES ($1,$2,$3,$4,'cleaning',$5,'open')`,
        [
          req.user.id,
          b.property_id,
          b.id,
          `Turnover clean — ${b.property_name}`,
          b.check_out,
        ]
      );
      created += 1;
    }
    res.json({ created });
  })
);

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------
app.get(
  '/api/reviews',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT r.*, p.name AS property_name
         FROM reviews r LEFT JOIN properties p ON p.id = r.property_id
        WHERE r.user_id = $1 ORDER BY r.reviewed_on DESC`,
      [req.user.id]
    );
    res.json(rows);
  })
);

app.post(
  '/api/reviews',
  auth,
  wrap(async (req, res) => {
    const { property_id, booking_id, guest_name, platform, rating, body, reviewed_on } = req.body || {};
    const r = Math.min(5, Math.max(1, Number(rating) || 5));
    const { rows } = await query(
      `INSERT INTO reviews (user_id, property_id, booking_id, guest_name, platform, rating, body, reviewed_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, property_id || null, booking_id || null, guest_name || null, platform || 'direct', r, body || null, reviewed_on || new Date().toISOString().slice(0, 10)]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/reviews/:id',
  auth,
  wrap(async (req, res) => {
    const { response } = req.body || {};
    const { rows } = await query(
      'UPDATE reviews SET response = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [response ?? null, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/reviews/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM reviews WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Review not found' });
    res.json({ deleted: true });
  })
);

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------
app.get(
  '/api/team',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query('SELECT * FROM team_members WHERE user_id = $1 ORDER BY created_at', [req.user.id]);
    res.json(rows);
  })
);

app.post(
  '/api/team',
  auth,
  wrap(async (req, res) => {
    const { name, email, phone, role } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      'INSERT INTO team_members (user_id, name, email, phone, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, name, email || null, phone || null, role || 'cleaner']
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/team/:id',
  auth,
  wrap(async (req, res) => {
    const fields = ['name', 'email', 'phone', 'role'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE team_members SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Team member not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/team/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM team_members WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Team member not found' });
    res.json({ deleted: true });
  })
);

// ---------------------------------------------------------------------------
// Run automations — fire due template messages for matching reservations
// ---------------------------------------------------------------------------
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

function renderTemplate(body, booking) {
  const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return body
    .replace(/\{\{guest\}\}/gi, (booking.guest_name || 'there').split(' ')[0])
    .replace(/\{\{property\}\}/gi, booking.property_name || 'your rental')
    .replace(/\{\{checkin\}\}/gi, fmt(booking.check_in))
    .replace(/\{\{checkout\}\}/gi, fmt(booking.check_out))
    .replace(/\{\{checkin_time\}\}/gi, booking.checkin_time || '4:00 PM')
    .replace(/\{\{checkout_time\}\}/gi, booking.checkout_time || '11:00 AM')
    .replace(/\{\{wifi\}\}/gi, booking.wifi_name || '')
    .replace(/\{\{wifi_password\}\}/gi, booking.wifi_password || '')
    .replace(/\{\{doorcode\}\}/gi, booking.door_code || '')
    .replace(/\{\{guide\}\}/gi, booking.property_id ? `${PUBLIC_URL}/guide/${booking.property_id}` : '')
    .replace(/\{\{trip\}\}/gi, booking.id ? `${PUBLIC_URL}/trip/${booking.id}` : '');
}

async function runAutomationsForUser(userId) {
  const templates = (
    await query(
      "SELECT * FROM message_templates WHERE user_id = $1 AND active = true AND trigger <> 'manual'",
      [userId]
    )
  ).rows;
  if (!templates.length) return { sent: 0, detail: [] };

  const bookings = (
    await query(
      `SELECT b.*, p.name AS property_name, p.wifi_name, p.wifi_password,
              p.checkin_time, p.checkout_time
         FROM bookings b JOIN properties p ON p.id = b.property_id
        WHERE b.user_id = $1 AND b.status <> 'cancelled'`,
      [userId]
    )
  ).rows;

  const today = new Date();
  const dayDiff = (d) => Math.round((new Date(d) - today) / 86400000);
  const matches = (trigger, b) => {
    if (trigger === 'booking_confirmed') return b.status === 'confirmed';
    if (trigger === 'before_checkin') return dayDiff(b.check_in) >= 0 && dayDiff(b.check_in) <= 1;
    if (trigger === 'after_checkout') return dayDiff(b.check_out) <= 0 && dayDiff(b.check_out) >= -1;
    return false;
  };

  let sent = 0;
  const detail = [];
  for (const t of templates) {
    for (const b of bookings) {
      if (!matches(t.trigger, b)) continue;
      const body = renderTemplate(t.body, b);
      const exists = await query(
        'SELECT id FROM messages WHERE user_id = $1 AND booking_id = $2 AND body = $3',
        [userId, b.id, body]
      );
      if (exists.rows.length) continue;
      await query(
        `INSERT INTO messages (user_id, property_id, booking_id, guest_name, platform, direction, body)
         VALUES ($1,$2,$3,$4,$5,'outgoing',$6)`,
        [userId, b.property_id, b.id, b.guest_name, b.platform, body]
      );
      sent += 1;
      detail.push({ template: t.name, guest: b.guest_name });
    }
  }
  return { sent, detail };
}

app.post(
  '/api/automations/run',
  auth,
  wrap(async (req, res) => {
    const result = await runAutomationsForUser(req.user.id);
    res.json(result);
  })
);

// Background scheduler: fire due automations for every user, hourly.
async function scheduledAutomationSweep() {
  try {
    const users = (await query('SELECT id FROM users')).rows;
    let total = 0;
    for (const u of users) {
      const r = await runAutomationsForUser(u.id);
      total += r.sent;
    }
    if (total > 0) console.log(`[scheduler] Sent ${total} automated message(s).`);
  } catch (err) {
    console.error('[scheduler] sweep failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// AI reply suggestions (uses Anthropic if configured, else rules-based)
// ---------------------------------------------------------------------------
function ruleBasedReply({ guest_name, property_name, last_message, check_in }) {
  const first = (guest_name || 'there').split(' ')[0];
  const msg = (last_message || '').toLowerCase();
  const prop = property_name || 'the property';
  if (/check.?in|arrive|arrival|what time/.test(msg)) {
    return `Hi ${first}! Check-in at ${prop} is from 4:00 PM. I'll send the door code and directions the morning of your arrival${check_in ? ` on ${new Date(check_in).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}. Let me know if you need an early check-in!`;
  }
  if (/park/.test(msg)) {
    return `Hi ${first}! Yes — there's free parking on-site at ${prop} for your vehicle. I'll include the exact spot in your check-in instructions.`;
  }
  if (/wifi|wi-fi|internet/.test(msg)) {
    return `Hi ${first}! ${prop} has fast Wi-Fi throughout. The network name and password are in the welcome guide inside, and I'll also text them to you at check-in.`;
  }
  if (/checkout|check.?out|leave|late/.test(msg)) {
    return `Hi ${first}! Checkout is at 11:00 AM. If you'd like a later checkout just ask and I'll do my best to accommodate depending on the next booking.`;
  }
  if (/hot tub|pool|amenit/.test(msg)) {
    return `Hi ${first}! The hot tub is ready to use during your stay — instructions are in the welcome guide. Let me know if you have any questions about the other amenities at ${prop}!`;
  }
  return `Hi ${first}! Thanks for reaching out. I'd be happy to help with anything for your stay at ${prop} — just let me know what you need.`;
}

app.post(
  '/api/ai/suggest-reply',
  auth,
  wrap(async (req, res) => {
    const ctx = req.body || {};
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) {
      try {
        const prompt =
          `You are a friendly, professional short-term-rental host assistant. Write a concise, warm reply ` +
          `to this guest message. Guest: ${ctx.guest_name || 'Guest'}. Property: ${ctx.property_name || 'the rental'}. ` +
          `Guest's message: "${ctx.last_message || '(no message yet — send a friendly check-in)'}". ` +
          `Reply in 2-4 sentences, no placeholders.`;
        const { data } = await axios.post(
          'https://api.anthropic.com/v1/messages',
          {
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
            max_tokens: 300,
            messages: [{ role: 'user', content: prompt }],
          },
          {
            headers: {
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            timeout: 20000,
          }
        );
        const text = data?.content?.[0]?.text?.trim();
        if (text) return res.json({ suggestion: text, source: 'ai' });
      } catch (err) {
        console.error('[ai] falling back to rules:', err.message);
      }
    }
    res.json({ suggestion: ruleBasedReply(ctx), source: 'rules' });
  })
);

// ---------------------------------------------------------------------------
// Notifications — actionable operational alerts
// ---------------------------------------------------------------------------
app.get(
  '/api/notifications',
  auth,
  wrap(async (req, res) => {
    const uid = req.user.id;
    const items = [];

    // Pending approvals
    const pending = (await query("SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = $1 AND status = 'pending'", [uid])).rows[0].n;
    if (pending > 0) items.push({ type: 'approval', text: `${pending} reservation${pending > 1 ? 's' : ''} awaiting approval`, to: '/bookings?status=pending' });

    // Overdue invoices
    const overdue = (await query("SELECT COUNT(*)::int AS n FROM invoices WHERE user_id = $1 AND status = 'unpaid' AND due_date < CURRENT_DATE", [uid])).rows[0].n;
    if (overdue > 0) items.push({ type: 'invoice', text: `${overdue} overdue invoice${overdue > 1 ? 's' : ''}`, to: '/billing' });

    // Check-ins today
    const cin = (await query("SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = $1 AND status <> 'cancelled' AND check_in = CURRENT_DATE", [uid])).rows[0].n;
    if (cin > 0) items.push({ type: 'checkin', text: `${cin} check-in${cin > 1 ? 's' : ''} today`, to: '/bookings' });

    // Open tasks due today or earlier
    const tasks = (await query("SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1 AND status <> 'done' AND due_date <= CURRENT_DATE", [uid])).rows[0].n;
    if (tasks > 0) items.push({ type: 'task', text: `${tasks} task${tasks > 1 ? 's' : ''} due`, to: '/tasks' });

    // Double-booking conflicts
    const rows = (
      await query(
        `SELECT property_id, check_in, check_out FROM bookings
          WHERE user_id = $1 AND status <> 'cancelled' ORDER BY property_id, check_in`,
        [uid]
      )
    ).rows;
    const byProp = {};
    for (const r of rows) (byProp[r.property_id] ||= []).push(r);
    let conflicts = 0;
    for (const list of Object.values(byProp)) {
      for (let i = 0; i < list.length; i += 1)
        for (let j = i + 1; j < list.length; j += 1)
          if (new Date(list[i].check_in) < new Date(list[j].check_out) && new Date(list[j].check_in) < new Date(list[i].check_out)) conflicts += 1;
    }
    if (conflicts > 0) items.push({ type: 'conflict', text: `${conflicts} double-booking conflict${conflicts > 1 ? 's' : ''}`, to: '/channels' });

    res.json({ count: items.length, items });
  })
);

// ---------------------------------------------------------------------------
// Onboarding checklist — drives the getting-started wizard
// ---------------------------------------------------------------------------
app.get(
  '/api/onboarding',
  auth,
  wrap(async (req, res) => {
    const uid = req.user.id;
    const [props, bookings, templates, user] = await Promise.all([
      query('SELECT COUNT(*)::int AS n, COUNT(airbnb_ical_url)::int AS ical FROM properties WHERE user_id = $1', [uid]),
      query('SELECT COUNT(*)::int AS n FROM bookings WHERE user_id = $1', [uid]),
      query('SELECT COUNT(*)::int AS n FROM message_templates WHERE user_id = $1', [uid]),
      query('SELECT brand_name, brand_color FROM users WHERE id = $1', [uid]),
    ]);
    const anyIcal = await query(
      `SELECT COUNT(*)::int AS n FROM properties
        WHERE user_id = $1 AND (airbnb_ical_url IS NOT NULL OR vrbo_ical_url IS NOT NULL OR booking_com_ical_url IS NOT NULL)`,
      [uid]
    );
    const steps = [
      { key: 'listing', label: 'Add your first listing', done: props.rows[0].n > 0, to: '/properties' },
      { key: 'channel', label: 'Connect a channel calendar (iCal)', done: anyIcal.rows[0].n > 0, to: '/channels' },
      { key: 'reservation', label: 'Add or import a reservation', done: bookings.rows[0].n > 0, to: '/bookings' },
      { key: 'template', label: 'Create a message template', done: templates.rows[0].n > 0, to: '/automations' },
      { key: 'branding', label: 'Brand your account', done: !!(user.rows[0]?.brand_name || user.rows[0]?.brand_color), to: '/settings' },
    ];
    const complete = steps.filter((s) => s.done).length;
    res.json({ steps, complete, total: steps.length });
  })
);

// ---------------------------------------------------------------------------
// Global search — listings, reservations (guests), invoices
// ---------------------------------------------------------------------------
app.get(
  '/api/search',
  auth,
  wrap(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q}%`;
    const [props, bookings, invoices] = await Promise.all([
      query('SELECT id, name FROM properties WHERE user_id = $1 AND name ILIKE $2 LIMIT 5', [req.user.id, like]),
      query(
        `SELECT b.id, b.guest_name, b.check_in, p.name AS property_name
           FROM bookings b JOIN properties p ON p.id = b.property_id
          WHERE b.user_id = $1 AND (b.guest_name ILIKE $2 OR b.guest_email ILIKE $2) LIMIT 6`,
        [req.user.id, like]
      ),
      query('SELECT id, number, guest_name FROM invoices WHERE user_id = $1 AND (number ILIKE $2 OR guest_name ILIKE $2) LIMIT 4', [req.user.id, like]),
    ]);
    const results = [
      ...props.rows.map((p) => ({ type: 'listing', label: p.name, sub: 'Listing', to: '/properties' })),
      ...bookings.rows.map((b) => ({
        type: 'reservation',
        label: b.guest_name,
        sub: `${b.property_name} · ${new Date(b.check_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        to: `/messages?booking=${b.id}`,
      })),
      ...invoices.rows.map((i) => ({ type: 'invoice', label: `${i.number} · ${i.guest_name || ''}`, sub: 'Invoice', to: '/billing' })),
    ];
    res.json({ results });
  })
);

// ---------------------------------------------------------------------------
// Dashboard analytics
// ---------------------------------------------------------------------------
app.get(
  '/api/dashboard',
  auth,
  wrap(async (req, res) => {
    const uid = req.user.id;
    const [props, bookings, expenses] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM properties WHERE user_id = $1', [uid]),
      query(
        `SELECT platform, status, check_in, check_out, total_amount
           FROM bookings WHERE user_id = $1`,
        [uid]
      ),
      query('SELECT COALESCE(SUM(amount),0)::float AS total FROM expenses WHERE user_id = $1', [uid]),
    ]);

    const now = new Date();
    const rows = bookings.rows;
    const revenue = rows
      .filter((b) => b.status !== 'cancelled')
      .reduce((s, b) => s + Number(b.total_amount || 0), 0);
    const totalExpenses = expenses.rows[0].total;
    const nightsBooked = rows
      .filter((b) => b.status !== 'cancelled')
      .reduce((s, b) => s + nights(b.check_in, b.check_out), 0);
    const upcoming = rows.filter(
      (b) => b.status !== 'cancelled' && new Date(b.check_in) >= now
    ).length;

    const byPlatform = rows.reduce((acc, b) => {
      acc[b.platform] = (acc[b.platform] || 0) + 1;
      return acc;
    }, {});

    res.json({
      properties: props.rows[0].n,
      bookings: rows.length,
      upcoming,
      nightsBooked,
      revenue,
      expenses: totalExpenses,
      profit: revenue - totalExpenses,
      byPlatform,
    });
  })
);

// ---------------------------------------------------------------------------
// Analytics — occupancy, ADR, RevPAR, revenue trend
// ---------------------------------------------------------------------------
app.get(
  '/api/analytics',
  auth,
  wrap(async (req, res) => {
    const uid = req.user.id;
    const [propsRes, bookingsRes, expensesRes, propListRes] = await Promise.all([
      query('SELECT COUNT(*)::int AS n FROM properties WHERE user_id = $1', [uid]),
      query(
        `SELECT property_id, platform, status, check_in, check_out, total_amount
           FROM bookings WHERE user_id = $1 AND status <> 'cancelled'`,
        [uid]
      ),
      query(
        `SELECT to_char(spent_on, 'YYYY-MM') AS month, SUM(amount)::float AS total
           FROM expenses WHERE user_id = $1 GROUP BY 1`,
        [uid]
      ),
      query('SELECT id, name FROM properties WHERE user_id = $1 ORDER BY created_at', [uid]),
    ]);

    const propertyCount = propsRes.rows[0].n || 0;
    const bookings = bookingsRes.rows;

    let totalNights = 0;
    let totalRevenue = 0;
    const monthlyRevenue = {};
    for (const b of bookings) {
      const n = nights(b.check_in, b.check_out);
      totalNights += n;
      const amt = Number(b.total_amount || 0);
      totalRevenue += amt;
      const key = new Date(b.check_in).toISOString().slice(0, 7); // robust YYYY-MM
      monthlyRevenue[key] = (monthlyRevenue[key] || 0) + amt;
    }

    // Forward-looking occupancy over the next 90 days (how booked am I?).
    const WINDOW = 90;
    const availableNights = propertyCount * WINDOW;
    const now = new Date();
    const windowEnd = new Date(now);
    windowEnd.setDate(now.getDate() + WINDOW);
    let bookedInWindow = 0;
    for (const b of bookings) {
      const ci = new Date(b.check_in);
      const co = new Date(b.check_out);
      const start = ci > now ? ci : now;
      const end = co < windowEnd ? co : windowEnd;
      const overlap = Math.round((end - start) / (1000 * 60 * 60 * 24));
      if (overlap > 0) bookedInWindow += overlap;
    }

    const adr = totalNights > 0 ? totalRevenue / totalNights : 0;
    const occupancy = availableNights > 0 ? (bookedInWindow / availableNights) * 100 : 0;
    const revpar = availableNights > 0 ? totalRevenue / availableNights : 0;

    // Build last 6 months revenue series.
    const series = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      series.push({
        month: key,
        label: d.toLocaleString('en-US', { month: 'short' }),
        revenue: Math.round(monthlyRevenue[key] || 0),
        expenses: Math.round(
          (expensesRes.rows.find((r) => r.month === key) || {}).total || 0
        ),
      });
    }

    // Per-listing breakdown (revenue, nights, next-90-day occupancy).
    const byListing = propListRes.rows.map((p) => {
      const bs = bookings.filter((b) => b.property_id === p.id);
      let rev = 0;
      let nts = 0;
      let booked = 0;
      for (const b of bs) {
        rev += Number(b.total_amount || 0);
        nts += nights(b.check_in, b.check_out);
        const ci = new Date(b.check_in);
        const co = new Date(b.check_out);
        const start = ci > now ? ci : now;
        const end = co < windowEnd ? co : windowEnd;
        const overlap = Math.round((end - start) / (1000 * 60 * 60 * 24));
        if (overlap > 0) booked += overlap;
      }
      return {
        id: p.id,
        name: p.name,
        revenue: Math.round(rev),
        nights: nts,
        occupancy: Math.round((booked / WINDOW) * 100),
      };
    }).sort((a, b) => b.revenue - a.revenue);

    res.json({
      properties: propertyCount,
      totalRevenue: Math.round(totalRevenue),
      totalNights,
      adr: Math.round(adr),
      occupancy: Math.round(occupancy),
      revpar: Math.round(revpar),
      series,
      byListing,
    });
  })
);

// ---------------------------------------------------------------------------
// Invoices — automated billing
// ---------------------------------------------------------------------------
app.get(
  '/api/invoices',
  auth,
  wrap(async (req, res) => {
    const { status } = req.query;
    const clauses = ['i.user_id = $1'];
    const vals = [req.user.id];
    if (status) {
      clauses.push('i.status = $2');
      vals.push(status);
    }
    const { rows } = await query(
      `SELECT i.*, p.name AS property_name
         FROM invoices i
         LEFT JOIN properties p ON p.id = i.property_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY i.issued_on DESC, i.created_at DESC`,
      vals
    );
    res.json(rows);
  })
);

async function nextInvoiceNumber(userId) {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM invoices WHERE user_id = $1', [userId]);
  const seq = (rows[0].n || 0) + 1;
  return `INV-${String(seq).padStart(4, '0')}`;
}

app.post(
  '/api/invoices',
  auth,
  wrap(async (req, res) => {
    const { property_id, booking_id, guest_name, amount, due_date, notes } = req.body || {};
    if (amount === undefined) return res.status(400).json({ error: 'amount is required' });
    const number = await nextInvoiceNumber(req.user.id);
    const { rows } = await query(
      `INSERT INTO invoices (user_id, property_id, booking_id, number, guest_name, amount, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, property_id || null, booking_id || null, number, guest_name || null, amount, due_date || null, notes || null]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/invoices/:id',
  auth,
  wrap(async (req, res) => {
    const fields = ['guest_name', 'amount', 'status', 'due_date', 'paid_on', 'payment_url', 'notes'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(req.body[f]);
      }
    }
    // Auto-stamp paid_on when marking paid.
    if (req.body.status === 'paid' && req.body.paid_on === undefined) {
      sets.push(`paid_on = $${i++}`);
      vals.push(new Date().toISOString().slice(0, 10));
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/invoices/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM invoices WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ deleted: true });
  })
);

// Auto-generate invoices from confirmed reservations that don't have one yet.
app.post(
  '/api/invoices/generate',
  auth,
  wrap(async (req, res) => {
    const { rows: bookings } = await query(
      `SELECT b.id, b.property_id, b.guest_name, b.total_amount, b.check_in
         FROM bookings b
         LEFT JOIN invoices i ON i.booking_id = b.id
        WHERE b.user_id = $1 AND b.status <> 'cancelled' AND i.id IS NULL AND b.total_amount > 0`,
      [req.user.id]
    );
    let created = 0;
    let seq = (await query('SELECT COUNT(*)::int AS n FROM invoices WHERE user_id = $1', [req.user.id]))
      .rows[0].n;
    for (const b of bookings) {
      seq += 1;
      await query(
        `INSERT INTO invoices (user_id, property_id, booking_id, number, guest_name, amount, due_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'unpaid')
         ON CONFLICT (user_id, booking_id) WHERE booking_id IS NOT NULL DO NOTHING`,
        [
          req.user.id,
          b.property_id,
          b.id,
          `INV-${String(seq).padStart(4, '0')}`,
          b.guest_name,
          b.total_amount,
          b.check_in,
        ]
      );
      created += 1;
    }
    res.json({ created });
  })
);

// ---------------------------------------------------------------------------
// Owner statements — per-property P&L for a month
// ---------------------------------------------------------------------------
app.get(
  '/api/statements',
  auth,
  wrap(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
      ? req.query.month
      : new Date().toISOString().slice(0, 7);

    const userRow = await query('SELECT mgmt_fee_pct FROM users WHERE id = $1', [req.user.id]);
    const feePct = Number(userRow.rows[0]?.mgmt_fee_pct || 0);

    const props = await query('SELECT id, name FROM properties WHERE user_id = $1', [req.user.id]);
    const bookings = await query(
      `SELECT property_id, total_amount, check_in FROM bookings
        WHERE user_id = $1 AND status <> 'cancelled'`,
      [req.user.id]
    );
    const expenses = await query(
      `SELECT property_id, amount, spent_on FROM expenses WHERE user_id = $1`,
      [req.user.id]
    );

    const inMonth = (d) => new Date(d).toISOString().slice(0, 7) === month;

    const rows = props.rows.map((p) => {
      const gross = bookings.rows
        .filter((b) => b.property_id === p.id && inMonth(b.check_in))
        .reduce((s, b) => s + Number(b.total_amount || 0), 0);
      const exp = expenses.rows
        .filter((e) => e.property_id === p.id && inMonth(e.spent_on))
        .reduce((s, e) => s + Number(e.amount || 0), 0);
      const mgmtFee = (gross * feePct) / 100;
      return {
        property_id: p.id,
        property: p.name,
        gross: Math.round(gross * 100) / 100,
        expenses: Math.round(exp * 100) / 100,
        mgmtFee: Math.round(mgmtFee * 100) / 100,
        net: Math.round((gross - exp - mgmtFee) * 100) / 100,
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        gross: t.gross + r.gross,
        expenses: t.expenses + r.expenses,
        mgmtFee: t.mgmtFee + r.mgmtFee,
        net: t.net + r.net,
      }),
      { gross: 0, expenses: 0, mgmtFee: 0, net: 0 }
    );

    res.json({ month, feePct, rows, totals });
  })
);

// ---------------------------------------------------------------------------
// Inbound webhook — Zapier / Make / email-parser → reservations
// ---------------------------------------------------------------------------
app.get(
  '/api/webhook-info',
  auth,
  wrap(async (req, res) => {
    let { rows } = await query('SELECT webhook_token FROM users WHERE id = $1', [req.user.id]);
    let token = rows[0]?.webhook_token;
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      await query('UPDATE users SET webhook_token = $1 WHERE id = $2', [token, req.user.id]);
    }
    res.json({ token, path: `/api/webhooks/reservations/${token}` });
  })
);

// Regenerate the token (invalidates the old URL).
app.post(
  '/api/webhook-info/rotate',
  auth,
  wrap(async (req, res) => {
    const token = crypto.randomBytes(16).toString('hex');
    await query('UPDATE users SET webhook_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ token, path: `/api/webhooks/reservations/${token}` });
  })
);

// Public receiver — Zapier POSTs parsed reservation data here.
app.post(
  '/api/webhooks/reservations/:token',
  wrap(async (req, res) => {
    const u = await query('SELECT id FROM users WHERE webhook_token = $1', [req.params.token]);
    if (!u.rows.length) return res.status(404).json({ error: 'Invalid webhook token' });
    const userId = u.rows[0].id;
    const b = req.body || {};

    // Flexible field mapping (Zapier email-parser fields vary).
    const pick = (...keys) => {
      for (const k of keys) {
        if (b[k] !== undefined && b[k] !== null && String(b[k]).trim() !== '') return b[k];
      }
      return null;
    };
    const guest = pick('guest_name', 'guest', 'name', 'guestName') || 'Guest';
    const checkIn = pick('check_in', 'checkin', 'arrival', 'start', 'checkIn');
    const checkOut = pick('check_out', 'checkout', 'departure', 'end', 'checkOut');
    if (!checkIn || !checkOut) {
      return res.status(400).json({ error: 'check_in and check_out are required' });
    }
    const platform = (pick('platform', 'source', 'channel') || 'airbnb').toLowerCase();
    const externalId = pick('external_id', 'confirmation_code', 'confirmationCode', 'id');

    // Attach to a named property, else the first one.
    let propId = pick('property_id');
    if (!propId) {
      const propName = pick('property', 'property_name', 'listing');
      if (propName) {
        const p = await query('SELECT id FROM properties WHERE user_id = $1 AND name ILIKE $2 LIMIT 1', [userId, `%${propName}%`]);
        propId = p.rows[0]?.id;
      }
    }
    if (!propId) {
      const p = await query('SELECT id FROM properties WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1', [userId]);
      propId = p.rows[0]?.id;
    }
    if (!propId) return res.status(400).json({ error: 'No property to attach the reservation to' });

    const result = await query(
      `INSERT INTO bookings
        (user_id, property_id, guest_name, guest_email, platform, external_id, check_in, check_out, guests, total_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed')
       ON CONFLICT (user_id, platform, external_id) WHERE external_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        userId, propId, guest,
        pick('guest_email', 'email'),
        platform, externalId, checkIn, checkOut,
        Number(pick('guests', 'num_guests')) || 1,
        Number(pick('total_amount', 'total', 'payout', 'amount')) || 0,
      ]
    );
    res.status(201).json({ ok: true, created: result.rows.length > 0 });
  })
);

// ---------------------------------------------------------------------------
// Public direct-booking (no auth) — a shareable booking-request page
// ---------------------------------------------------------------------------
app.get(
  '/api/public/host/:userId',
  wrap(async (req, res) => {
    const u = await query(
      'SELECT id, name, company, brand_name, brand_color FROM users WHERE id = $1',
      [req.params.userId]
    );
    if (!u.rows.length) return res.status(404).json({ error: 'Host not found' });
    const props = await query(
      `SELECT id, name, city, country, bedrooms, bathrooms, max_guests, base_price,
              description, amenities, photos
         FROM properties WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.params.userId]
    );
    res.json({ host: u.rows[0], properties: props.rows });
  })
);

app.post(
  '/api/public/bookings',
  wrap(async (req, res) => {
    const { host_id, property_id, guest_name, guest_email, check_in, check_out, guests, message } =
      req.body || {};
    if (!host_id || !property_id || !guest_name || !check_in || !check_out) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Verify the property belongs to the host.
    const owns = await query('SELECT id FROM properties WHERE id = $1 AND user_id = $2', [
      property_id,
      host_id,
    ]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Property not found' });

    const booking = await query(
      `INSERT INTO bookings
        (user_id, property_id, guest_name, guest_email, platform, check_in, check_out, guests, total_amount, status)
       VALUES ($1,$2,$3,$4,'direct',$5,$6,$7,0,'pending') RETURNING id`,
      [host_id, property_id, guest_name, guest_email || null, check_in, check_out, guests || 1]
    );
    if (message) {
      await query(
        `INSERT INTO messages (user_id, property_id, booking_id, guest_name, platform, direction, body)
         VALUES ($1,$2,$3,$4,'direct','incoming',$5)`,
        [host_id, property_id, booking.rows[0].id, guest_name, message]
      );
    }
    res.status(201).json({ ok: true, message: 'Booking request received' });
  })
);

// ---------------------------------------------------------------------------
// Public guest trip portal (no auth) — guest views their own stay by booking id
// ---------------------------------------------------------------------------
app.get(
  '/api/public/reservation/:bookingId',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT b.guest_name, b.check_in, b.check_out, b.guests, b.door_code, b.property_id,
              p.name AS property_name, p.city, p.country, p.photos, p.address,
              p.wifi_name, p.wifi_password, p.checkin_time, p.checkout_time,
              p.house_rules, p.guidebook,
              u.brand_name, u.company, u.brand_color
         FROM bookings b JOIN properties p ON p.id = b.property_id
         JOIN users u ON u.id = b.user_id
        WHERE b.id = $1 AND b.status <> 'cancelled'`,
      [req.params.bookingId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    res.json(rows[0]);
  })
);

// ---------------------------------------------------------------------------
// Public guest guidebook (no auth) — shareable per-listing guide
// ---------------------------------------------------------------------------
app.get(
  '/api/public/guide/:propertyId',
  wrap(async (req, res) => {
    const { rows } = await query(
      `SELECT p.name, p.city, p.country, p.photos, p.amenities, p.description,
              p.wifi_name, p.wifi_password, p.checkin_time, p.checkout_time,
              p.house_rules, p.guidebook, p.address,
              u.brand_name, u.company, u.brand_color
         FROM properties p JOIN users u ON u.id = p.user_id
        WHERE p.id = $1`,
      [req.params.propertyId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Guide not found' });
    res.json(rows[0]);
  })
);

// ---------------------------------------------------------------------------
// Outbound availability iCal feed — OTAs subscribe to block PanHost's dates
// ---------------------------------------------------------------------------
function toICSDate(d) {
  return new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
}

app.get(
  '/api/public/ical/:propertyId.ics',
  wrap(async (req, res) => {
    const prop = await query('SELECT id, name FROM properties WHERE id = $1', [req.params.propertyId]);
    if (!prop.rows.length) return res.status(404).type('text/plain').send('Not found');

    const bookings = await query(
      `SELECT id, guest_name, check_in, check_out FROM bookings
        WHERE property_id = $1 AND status <> 'cancelled' ORDER BY check_in`,
      [req.params.propertyId]
    );

    const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//PanHost//Availability//EN',
      'CALSCALE:GREGORIAN',
      `X-WR-CALNAME:${prop.rows[0].name} — PanHost`,
    ];
    for (const b of bookings.rows) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${b.id}@panhost`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${toICSDate(b.check_in)}`,
        `DTEND;VALUE=DATE:${toICSDate(b.check_out)}`,
        'SUMMARY:Reserved',
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    res.type('text/calendar').send(lines.join('\r\n'));
  })
);

// ---------------------------------------------------------------------------
// 404 + boot
// ---------------------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const server = app.listen(PORT, () => {
  console.log(`[server] Property Manager API listening on http://localhost:${PORT}`);
});

// Fire automations hourly (and once shortly after boot).
const AUTOMATION_INTERVAL_MS = 60 * 60 * 1000;
setTimeout(scheduledAutomationSweep, 30 * 1000);
const automationTimer = setInterval(scheduledAutomationSweep, AUTOMATION_INTERVAL_MS);
automationTimer.unref?.();

// Graceful shutdown for containers / dev restarts.
function shutdown() {
  console.log('[server] Shutting down...');
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
