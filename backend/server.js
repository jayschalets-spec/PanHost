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
import { fetchListingViaStayingApi, fetchAvailabilityViaStayingApi, searchMarket, stayingApiConfigured } from './stayingapi.js';
import { integrationStatus, fetchReservationsViaApi } from './integrations.js';
import { sendEmail, emailTemplate, emailConfigured } from './email.js';
import { seasonalityFactor } from './seasonality.js';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Fail closed: the fallback secret is public (it's in this repo), so booting with it
// in production would let anyone mint a valid token for any account.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  console.error('[server] FATAL: set JWT_SECRET to a long random value before starting in production.');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

// Rate limiting. Render runs behind a proxy, so trust it for correct client IPs.
app.set('trust proxy', 1);

// Brute-force guard for credential endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Abuse guard for unauthenticated public writes (booking requests, reviews).
const publicWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

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
  return jwt.sign(
    { id: user.id, email: user.email, owner_id: user.owner_id || null, role: user.role || 'owner' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // All account data is scoped to the owner. Staff act within their owner's account.
    req.accountId = req.user.owner_id || req.user.id;
    req.role = req.user.role || 'owner';
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Restrict a route to account owners (not staff).
function ownerOnly(req, res, next) {
  if (req.user.owner_id) return res.status(403).json({ error: 'Owner access required' });
  next();
}

// Role tiers for invited staff. Owners always rank highest; an invited member's
// rank comes from their role. Cleaners/maintenance are deliberately read-mostly:
// before this, any invited staff could delete listings and edit invoices.
const ROLE_RANK = { owner: 3, 'co-host': 2, maintenance: 1, cleaner: 1 };

function minRole(rank) {
  return function (req, res, next) {
    const role = req.user.owner_id ? req.user.role || 'cleaner' : 'owner';
    if ((ROLE_RANK[role] || 0) < rank) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }
    next();
  };
}

// Co-host or owner: day-to-day operational writes.
const coHostPlus = minRole(2);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// True when this property belongs to the account. Any endpoint that accepts a
// caller-supplied property_id must check this — rows are keyed by property_id in
// the public statement/iCal views, so an unchecked id lets one tenant write onto
// another tenant's listing.
async function ownsProperty(propertyId, accountId) {
  if (!propertyId || !UUID_RE.test(String(propertyId))) return false;
  const { rows } = await query('SELECT id FROM properties WHERE id = $1 AND user_id = $2', [propertyId, accountId]);
  return rows.length > 0;
}

// Unguessable capability token for the shareable owner-statement link. The property
// UUID alone can't gate financials: it is handed to every guest in the guidebook link
// and to the OTAs in the iCal feed.
function statementToken(propertyId) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`stmt:${propertyId}`).digest('hex').slice(0, 32);
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
  authLimiter,
  wrap(async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (password.length < 10) {
      return res.status(400).json({ error: 'password must be at least 10 characters' });
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
    // Welcome email (sends when SMTP configured; otherwise logged).
    sendEmail({
      userId: user.id,
      to: user.email,
      subject: 'Welcome to PanHost 🎉',
      html: emailTemplate({
        heading: `Welcome${user.name ? `, ${user.name.split(' ')[0]}` : ''}!`,
        lines: [
          'Your PanHost account is ready. You can now add listings, connect channels, and manage reservations from one dashboard.',
          'Log in any time to get started.',
        ],
        cta: { label: 'Open PanHost', url: process.env.PUBLIC_URL || 'http://localhost:3000' },
      }),
    });
    res.status(201).json({ token: signToken(user), user });
  })
);

app.post(
  '/api/auth/login',
  authLimiter,
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const { rows } = await query(
      'SELECT id, email, name, password_hash, owner_id, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const safe = { id: user.id, email: user.email, name: user.name, owner_id: user.owner_id, role: user.role };
    res.json({ token: signToken(safe), user: safe });
  })
);

app.get(
  '/api/auth/me',
  auth,
  wrap(async (req, res) => {
    // Identity comes from the logged-in user; branding/currency from the account owner.
    const me = await query('SELECT id, email, name, role, owner_id, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!me.rows.length) return res.status(404).json({ error: 'User not found' });
    const acct = await query(
      'SELECT company, brand_name, brand_color, mgmt_fee_pct, currency FROM users WHERE id = $1',
      [req.accountId]
    );
    res.json({ ...me.rows[0], ...(acct.rows[0] || {}), is_owner: !req.user.owner_id });
  })
);

// Update profile / white-label branding (owner only).
app.put(
  '/api/branding',
  auth,
  ownerOnly,
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
    vals.push(req.accountId);
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
      [req.accountId]
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
         description, amenities, photos, airbnb_ical_url, vrbo_ical_url, booking_com_ical_url, airbnb_listing_id, notes,
         demand_pricing, seasonality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, true, true) RETURNING *`,
      [
        req.accountId,
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
  coHostPlus,
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
      'min_price',
      'demand_pricing',
      'demand_strength',
      'market_anchor',
      'seasonality',
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
    vals.push(req.params.id, req.accountId);
    const { rows } = await query(
      `UPDATE properties SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Property not found' });
    // Enabling market anchor with no cached median yet → fetch it now (best-effort).
    if (req.body.market_anchor === true && !rows[0].market_median && stayingApiConfigured()) {
      try {
        const med = await refreshMarketMedian(rows[0]);
        if (med) rows[0].market_median = med;
      } catch { /* non-fatal; scheduler will retry */ }
    }
    res.json(rows[0]);
  })
);

app.delete(
  '/api/properties/:id',
  auth,
  ownerOnly,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM properties WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.accountId,
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
    const vals = [req.accountId];
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
      req.accountId,
    ]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Property not found' });

    const { rows } = await query(
      `INSERT INTO bookings
        (user_id, property_id, guest_name, guest_email, platform, check_in, check_out, guests, total_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        req.accountId,
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
    vals.push(req.params.id, req.accountId);
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
  coHostPlus,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM bookings WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.accountId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Booking not found' });
    res.json({ deleted: true });
  })
);

// Generate a smart-lock door code for a reservation.
app.post(
  '/api/bookings/:id/lockcode',
  auth,
  coHostPlus,
  wrap(async (req, res) => {
    const code = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit
    const { rows } = await query(
      'UPDATE bookings SET door_code = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [code, req.params.id, req.accountId]
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
      [req.accountId]
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
    [req.accountId, platform, property_ref || null, access_token]
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
    [req.accountId, platform]
  );
  if (!cred.rows.length) {
    return res.status(400).json({ error: `No ${platform} credentials connected` });
  }

  // Pick the property to attach imported bookings to.
  const prop = await query(
    'SELECT id FROM properties WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
    [req.accountId]
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
        req.accountId,
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
      [req.accountId]
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
          const r = await importIcal(req.accountId, p, platform, url);
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
    const platform = (req.body?.platform || 'airbnb').toLowerCase();
    const listingId = extractListingId(req.body?.listing_id || req.body?.url);
    if (!listingId) {
      return res
        .status(400)
        .json({ error: 'Provide the listing URL or ID.' });
    }

    // Preferred: StayingAPI (reliable, key-based). Fallback: direct public scrape.
    if (stayingApiConfigured()) {
      try {
        const data = await fetchListingViaStayingApi(platform, listingId);
        if (data.photos.length || data.title) return res.json(data);
        return res.status(422).json({ error: 'StayingAPI returned no data for that listing.' });
      } catch (err) {
        const msg = err.response?.data?.error || err.message;
        return res.status(502).json({ error: `StayingAPI error: ${msg}` });
      }
    }

    try {
      const data = await fetchAirbnbListing(listingId);
      if (data.photos.length === 0) {
        return res.status(422).json({
          error:
            'Airbnb blocked the automated request. Add a free StayingAPI key (Settings → Integrations) for reliable listing import, or enter the content manually.',
        });
      }
      res.json({ listing_id: listingId, ...data });
    } catch (err) {
      if (err.response && (err.response.status === 404 || err.response.status === 410)) {
        return res.status(422).json({ error: 'Listing not found or not public yet.' });
      }
      res.status(502).json({ error: `Could not reach Airbnb (${err.message}). Add a StayingAPI key for reliable import.` });
    }
  })
);

// Public listing availability via StayingAPI (for a listing with airbnb_listing_id).
app.get(
  '/api/listings/:id/availability',
  auth,
  wrap(async (req, res) => {
    const prop = (await query('SELECT airbnb_listing_id FROM properties WHERE id = $1 AND user_id = $2', [req.params.id, req.accountId])).rows[0];
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    if (!prop.airbnb_listing_id) return res.status(400).json({ error: 'Set the Airbnb listing ID on this listing first' });
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 60);
    const fmt = (d) => d.toISOString().slice(0, 10);
    try {
      const days = await fetchAvailabilityViaStayingApi('airbnb', prop.airbnb_listing_id, fmt(start), fmt(end));
      res.json({ days });
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') return res.status(400).json({ error: err.message });
      res.status(502).json({ error: err.response?.data?.error || err.message });
    }
  })
);

// ---------------------------------------------------------------------------
// Official OTA integrations — status + partner-API sync (when configured)
// ---------------------------------------------------------------------------
app.get('/api/integrations', auth, (req, res) =>
  res.json({
    integrations: integrationStatus(),
    listingData: { provider: 'StayingAPI', configured: stayingApiConfigured(), signupUrl: 'https://stayingapi.com' },
  })
);

app.post(
  '/api/integrations/:platform/sync',
  auth,
  wrap(async (req, res) => {
    const platform = req.params.platform;
    // Attach imported reservations to the user's first property (or a named one).
    const prop = await query(
      'SELECT id FROM properties WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [req.accountId]
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
          [req.accountId, prop.rows[0].id, b.guest_name, b.guest_email, platform, b.external_id, b.check_in, b.check_out, b.guests, b.total_amount]
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
      [req.accountId]
    );
    const bookings = await query(
      `SELECT property_id, platform, COUNT(*)::int AS n
         FROM bookings WHERE user_id = $1 AND status <> 'cancelled'
        GROUP BY property_id, platform`,
      [req.accountId]
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
      [req.accountId]
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
      [req.accountId]
    );
    res.json(rows);
  })
);

app.post(
  '/api/pricing',
  auth,
  wrap(async (req, res) => {
    const { property_id, name, kind, start_date, end_date, price, adjust, percent, min_stay, priority } = req.body || {};
    if (!property_id || !name) {
      return res.status(400).json({ error: 'property_id and name are required' });
    }
    if (adjust === 'percent' ? percent === undefined : price === undefined) {
      return res.status(400).json({ error: 'Provide a price (fixed) or percent (percent adjustment)' });
    }
    const owns = await query('SELECT id FROM properties WHERE id = $1 AND user_id = $2', [property_id, req.accountId]);
    if (!owns.rows.length) return res.status(404).json({ error: 'Property not found' });
    const { rows } = await query(
      `INSERT INTO pricing_rules (user_id, property_id, name, kind, start_date, end_date, price, adjust, percent, min_stay, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.accountId, property_id, name,
        kind || 'seasonal',
        start_date || null, end_date || null,
        adjust === 'percent' ? null : price,
        adjust || 'fixed',
        adjust === 'percent' ? percent : null,
        min_stay || 1,
        priority || (kind === 'weekend' ? 10 : 0),
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/pricing/:id',
  auth,
  wrap(async (req, res) => {
    const fields = ['name', 'kind', 'start_date', 'end_date', 'price', 'adjust', 'percent', 'min_stay', 'priority'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(req.body[f]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id, req.accountId);
    const { rows } = await query(
      `UPDATE pricing_rules SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Pricing rule not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/pricing/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM pricing_rules WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.accountId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Pricing rule not found' });
    res.json({ deleted: true });
  })
);

// Dynamic-pricing engine: compute nightly price + min-stay for a date window.
app.get(
  '/api/pricing/preview',
  auth,
  wrap(async (req, res) => {
    const propertyId = req.query.property_id;
    const days = Math.min(120, Math.max(7, Number(req.query.days) || 45));
    const prop = (await query(
      'SELECT id, name, base_price, min_price, demand_pricing, demand_strength, market_anchor, market_median, seasonality FROM properties WHERE id = $1 AND user_id = $2',
      [propertyId, req.accountId]
    )).rows[0];
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    const base = Number(prop.base_price || 0);
    const floor = Number(prop.min_price || 0);
    const demandOn = prop.demand_pricing;
    const strength = Number(prop.demand_strength || 20);
    const marketMedian = Number(prop.market_median || 0);
    const anchor = prop.market_anchor && marketMedian > 0;
    const seasonOn = prop.seasonality !== false;
    // Reference price: the real market median (when anchoring), else your base.
    const ref = anchor ? marketMedian : base;

    const rules = (await query('SELECT * FROM pricing_rules WHERE user_id = $1 AND property_id = $2 ORDER BY priority ASC', [req.accountId, propertyId])).rows;
    const bookings = (await query(
      `SELECT check_in, check_out FROM bookings WHERE user_id = $1 AND property_id = $2 AND status <> 'cancelled'`,
      [req.accountId, propertyId]
    )).rows;

    const isoOf = (v) => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).slice(0, 10);
    };
    const isBooked = (d) => bookings.some((b) => d >= isoOf(b.check_in) && d < isoOf(b.check_out));
    const inRange = (r, d) => (!r.start_date || d >= isoOf(r.start_date)) && (!r.end_date || d <= isoOf(r.end_date));

    const today = new Date();
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const daysUntil = (dt) => Math.round((dt - midnight) / 86400000);

    // Occupancy pace around a date (±window) — our demand proxy.
    const occAround = (dt) => {
      const W = 10;
      let booked = 0;
      for (let i = -W; i <= W; i += 1) {
        const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + i);
        if (isBooked(isoOf(d))) booked += 1;
      }
      return booked / (W * 2 + 1); // 0..1
    };

    const out = [];
    for (let k = 0; k < days; k += 1) {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k);
      const iso = isoOf(dt);
      const dow = dt.getDay();
      const isWeekend = dow === 5 || dow === 6;
      const dUntil = daysUntil(dt);
      let price = ref;
      let minStay = 1;
      const applied = [];
      let demandPct = 0;
      if (anchor) applied.push(`Market $${Math.round(marketMedian)}`);

      // 1) Demand-based auto adjustment (occupancy pace + lead time).
      if (demandOn && ref > 0) {
        const occ = occAround(dt);
        let signal = (occ - 0.5) * 2; // -1..+1
        if (dUntil <= 7) signal -= 0.5; // last-minute softness
        else if (dUntil >= 60) signal += 0.3; // far-out premium
        signal = Math.max(-1, Math.min(1, signal));
        demandPct = Math.round(signal * strength);
        price = price * (1 + demandPct / 100);
        if (demandPct !== 0) applied.push(`Demand ${demandPct > 0 ? '+' : ''}${demandPct}%`);
      }

      // 2) Resort seasonality (ski/lake curve + Canadian holidays & long weekends).
      let seasonPct = 0;
      if (seasonOn && ref > 0) {
        const s = seasonalityFactor(dt);
        seasonPct = s.pct;
        if (seasonPct !== 0) {
          price = price * (1 + seasonPct / 100);
          const tag = s.labels[0] || 'Season';
          applied.push(`${tag} ${seasonPct > 0 ? '+' : ''}${seasonPct}%`);
        }
      }

      // 3) Manual rules (priority order): fixed overrides, percent stacks, lead-time windows.
      for (const r of rules) {
        let matches = false;
        if (r.kind === 'weekend') matches = isWeekend;
        else if (r.kind === 'lastminute') matches = r.window_days != null && dUntil <= r.window_days;
        else if (r.kind === 'faraway') matches = r.window_days != null && dUntil >= r.window_days;
        else matches = inRange(r, iso);
        if (!matches) continue;
        if (r.adjust === 'percent' && r.percent != null) price = price * (1 + Number(r.percent) / 100);
        else if (r.price != null) price = Number(r.price);
        if (r.min_stay && r.min_stay > minStay) minStay = r.min_stay;
        applied.push(r.name);
      }

      // 4) Floor.
      if (floor > 0 && price < floor) price = floor;

      out.push({ date: iso, weekend: isWeekend, price: Math.round(price), min_stay: minStay, booked: isBooked(iso), demand: demandPct, season: seasonPct, rules: applied });
    }
    res.json({ property: prop.name, base, min_price: floor, demand_pricing: demandOn, demand_strength: strength, market_anchor: anchor, market_median: marketMedian, seasonality: seasonOn, days: out });
  })
);

// ---------------------------------------------------------------------------
// Market data — comparable listings near this property (StayingAPI)
// ---------------------------------------------------------------------------
function haversineKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some((v) => v == null)) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) * 10) / 10;
}
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Recompute + cache the market median for one property (used by the endpoint and scheduler).
async function refreshMarketMedian(prop) {
  if (!stayingApiConfigured()) return null;
  const location = prop.address ? `${prop.address}, ${prop.city || ''}` : [prop.city, prop.country].filter(Boolean).join(', ');
  if (!location.trim()) return null;
  const comps = await searchMarket({ location, limit: 40 });
  const priced = comps.filter((c) => c.nightly != null && c.nightly > 0);
  const comparable = prop.bedrooms
    ? priced.filter((c) => c.bedrooms == null || Math.abs(c.bedrooms - prop.bedrooms) <= 1)
    : priced;
  const set = comparable.length >= 3 ? comparable : priced;
  const med = median(set.map((c) => c.nightly));
  if (med > 0) await query('UPDATE properties SET market_median = $1, market_updated_at = now() WHERE id = $2', [med, prop.id]);
  return med;
}

app.get(
  '/api/market',
  auth,
  wrap(async (req, res) => {
    const prop = (await query(
      'SELECT id, name, address, city, country, bedrooms, base_price, airbnb_listing_id, lat, lng FROM properties WHERE id = $1 AND user_id = $2',
      [req.query.property_id, req.accountId]
    )).rows[0];
    if (!prop) return res.status(404).json({ error: 'Property not found' });
    const location = prop.address ? `${prop.address}, ${prop.city || ''}` : [prop.city, prop.country].filter(Boolean).join(', ');
    if (!location.trim()) return res.status(400).json({ error: 'Add a city or address to this listing to analyze its market.' });

    try {
      // Backfill our coordinates from StayingAPI listing details if we don't have them.
      let { lat, lng } = prop;
      if ((lat == null || lng == null) && prop.airbnb_listing_id && stayingApiConfigured()) {
        try {
          const det = await fetchListingViaStayingApi('airbnb', prop.airbnb_listing_id);
          if (det.lat != null && det.lng != null) {
            lat = det.lat; lng = det.lng;
            await query('UPDATE properties SET lat = $1, lng = $2 WHERE id = $3', [lat, lng, prop.id]);
          }
        } catch { /* non-fatal */ }
      }

      const comps = await searchMarket({
        location,
        checkIn: req.query.checkin,
        checkOut: req.query.checkout,
        adults: req.query.adults ? Number(req.query.adults) : undefined,
        limit: 40,
      });

      // Add proximity distance when we know our coords; sort by nearest else by price.
      for (const c of comps) c.distance_km = haversineKm(lat, lng, c.lat, c.lng);
      const haveDist = comps.some((c) => c.distance_km != null);
      comps.sort((a, b) =>
        haveDist ? (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9) : (a.nightly ?? 1e9) - (b.nightly ?? 1e9)
      );

      // Comparable set: similar bedroom count (±1) with a nightly price.
      const priced = comps.filter((c) => c.nightly != null && c.nightly > 0);
      const comparable = prop.bedrooms
        ? priced.filter((c) => c.bedrooms == null || Math.abs(c.bedrooms - prop.bedrooms) <= 1)
        : priced;
      const set = comparable.length >= 3 ? comparable : priced;
      const prices = set.map((c) => c.nightly);
      const stats = {
        count: set.length,
        median: median(prices),
        avg: prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0,
        min: prices.length ? Math.min(...prices) : 0,
        max: prices.length ? Math.max(...prices) : 0,
      };
      const ourPrice = Number(prop.base_price || 0);
      const percentile = prices.length
        ? Math.round((prices.filter((p) => p <= ourPrice).length / prices.length) * 100)
        : null;

      // Cache the market median so the pricing engine can anchor to it.
      if (stats.median > 0) {
        await query('UPDATE properties SET market_median = $1, market_updated_at = now() WHERE id = $2', [stats.median, prop.id]);
      }

      res.json({
        location,
        hasCoords: lat != null && lng != null,
        ourPrice,
        stats,
        percentile,
        suggested: stats.median,
        comps: comps.slice(0, 24),
      });
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') {
        return res.status(400).json({ error: 'Add a free StayingAPI key (STAYINGAPI_KEY) to pull live market data.' });
      }
      res.status(502).json({ error: err.response?.data?.error || err.message });
    }
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
      [req.accountId]
    );
    res.json(rows);
  })
);

app.post(
  '/api/expenses',
  auth,
  coHostPlus,
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
    if (property_id && !(await ownsProperty(property_id, req.accountId))) {
      return res.status(400).json({ error: 'Unknown property' });
    }
    const { rows } = await query(
      `INSERT INTO expenses (user_id, property_id, category, description, amount, spent_on, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.accountId,
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
  coHostPlus,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.accountId,
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
      [req.accountId]
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
        req.accountId,
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
      [req.accountId]
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
      [req.accountId, name, body, trg, active !== false]
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
    vals.push(req.params.id, req.accountId);
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
      req.accountId,
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
    const vals = [req.accountId];
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
        req.accountId,
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
    vals.push(req.params.id, req.accountId);
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
      req.accountId,
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
      [req.accountId]
    );
    let created = 0;
    for (const b of bookings) {
      const exists = await query(
        `SELECT id FROM tasks WHERE user_id = $1 AND booking_id = $2 AND type = 'cleaning'`,
        [req.accountId, b.id]
      );
      if (exists.rows.length) continue;
      await query(
        `INSERT INTO tasks (user_id, property_id, booking_id, title, type, due_date, status)
         VALUES ($1,$2,$3,$4,'cleaning',$5,'open')`,
        [
          req.accountId,
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
      [req.accountId]
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
      [req.accountId, property_id || null, booking_id || null, guest_name || null, platform || 'direct', r, body || null, reviewed_on || new Date().toISOString().slice(0, 10)]
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
      [response ?? null, req.params.id, req.accountId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Review not found' });
    res.json(rows[0]);
  })
);

app.delete(
  '/api/reviews/:id',
  auth,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM reviews WHERE id = $1 AND user_id = $2', [req.params.id, req.accountId]);
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
    const { rows } = await query('SELECT * FROM team_members WHERE user_id = $1 ORDER BY created_at', [req.accountId]);
    res.json(rows);
  })
);

app.post(
  '/api/team',
  auth,
  ownerOnly,
  wrap(async (req, res) => {
    const { name, email, phone, role } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      'INSERT INTO team_members (user_id, name, email, phone, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.accountId, name, email || null, phone || null, role || 'cleaner']
    );
    // Confirmation email to the new team member.
    if (email) {
      const owner = (await query('SELECT brand_name, company, name FROM users WHERE id = $1', [req.accountId])).rows[0] || {};
      const brand = owner.brand_name || owner.company || 'PanHost';
      sendEmail({
        userId: req.accountId,
        to: email,
        subject: `You've been added to ${brand} on PanHost`,
        html: emailTemplate({
          heading: `Welcome to the team, ${name.split(' ')[0]}!`,
          lines: [
            `${owner.name || 'Your host'} added you to <strong>${brand}</strong> as <strong>${role || 'cleaner'}</strong>.`,
            'You\'ll receive tasks and turnover assignments here. We\'ll be in touch with next steps.',
          ],
        }),
      });
    }
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/team/:id',
  auth,
  ownerOnly,
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
    vals.push(req.params.id, req.accountId);
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
  ownerOnly,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM team_members WHERE id = $1 AND user_id = $2', [req.params.id, req.accountId]);
    if (!rowCount) return res.status(404).json({ error: 'Team member not found' });
    res.json({ deleted: true });
  })
);

// Invite a team member to log in (creates a scoped staff user + emails a link).
app.post(
  '/api/team/:id/invite',
  auth,
  ownerOnly,
  wrap(async (req, res) => {
    const tm = (await query('SELECT * FROM team_members WHERE id = $1 AND user_id = $2', [req.params.id, req.accountId])).rows[0];
    if (!tm) return res.status(404).json({ error: 'Team member not found' });
    if (!tm.email) return res.status(400).json({ error: 'Add an email to this team member first' });

    const existing = (await query('SELECT id, owner_id, invite_status FROM users WHERE email = $1', [tm.email.toLowerCase()])).rows[0];
    // Only a still-pending invite that already belongs to THIS account may be re-issued.
    // Anything else (an independent owner with owner_id NULL, an active login, or staff
    // of another account) must never be absorbed into this tenant — doing so would
    // reassign someone else's account and let us overwrite their password.
    if (existing) {
      const reissuable = existing.owner_id === req.accountId && existing.invite_status === 'pending';
      if (!reissuable) {
        return res.status(409).json({ error: 'That email already has a PanHost account' });
      }
    }

    const token = crypto.randomBytes(24).toString('hex');
    if (existing) {
      await query('UPDATE users SET invite_token = $1, invite_status = $2, role = $3, owner_id = $4, name = COALESCE(name,$5) WHERE id = $6',
        [token, 'pending', tm.role, req.accountId, tm.name, existing.id]);
    } else {
      await query(
        'INSERT INTO users (email, name, role, owner_id, invite_token, invite_status) VALUES ($1,$2,$3,$4,$5,$6)',
        [tm.email.toLowerCase(), tm.name, tm.role, req.accountId, token, 'pending']
      );
    }

    const owner = (await query('SELECT brand_name, company, name FROM users WHERE id = $1', [req.accountId])).rows[0] || {};
    const brand = owner.brand_name || owner.company || 'PanHost';
    const link = `${process.env.PUBLIC_URL || 'http://localhost:3000'}/accept-invite?token=${token}`;
    await sendEmail({
      userId: req.accountId,
      to: tm.email,
      subject: `${brand} invited you to PanHost`,
      html: emailTemplate({
        heading: `You're invited, ${(tm.name || '').split(' ')[0] || 'there'}!`,
        lines: [
          `${owner.name || 'Your host'} invited you to join <strong>${brand}</strong> on PanHost as <strong>${tm.role}</strong>.`,
          'Click below to set your password and log in.',
        ],
        cta: { label: 'Accept invite', url: link },
      }),
    });
    res.json({ ok: true, invited: tm.email, link });
  })
);

// Public: look up an invite by token (for the accept page).
app.get(
  '/api/auth/invite/:token',
  wrap(async (req, res) => {
    const u = (await query("SELECT email, name, role, owner_id FROM users WHERE invite_token = $1 AND invite_status = 'pending'", [req.params.token])).rows[0];
    if (!u) return res.status(404).json({ error: 'Invite not found or already used' });
    const owner = (await query('SELECT brand_name, company FROM users WHERE id = $1', [u.owner_id])).rows[0] || {};
    res.json({ email: u.email, name: u.name, role: u.role, brand: owner.brand_name || owner.company || 'PanHost' });
  })
);

// Public: accept an invite — set password and activate the login.
app.post(
  '/api/auth/accept-invite',
  authLimiter,
  wrap(async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
    if (password.length < 10) return res.status(400).json({ error: 'password must be at least 10 characters' });
    const u = (await query("SELECT * FROM users WHERE invite_token = $1 AND invite_status = 'pending'", [token])).rows[0];
    if (!u) return res.status(404).json({ error: 'Invite not found or already used' });
    const hash = await bcrypt.hash(password, 10);
    await query("UPDATE users SET password_hash = $1, invite_status = 'active', invite_token = NULL WHERE id = $2", [hash, u.id]);
    const safe = { id: u.id, email: u.email, name: u.name, owner_id: u.owner_id, role: u.role };
    res.json({ token: signToken(safe), user: safe });
  })
);

// ---------------------------------------------------------------------------
// Email — status + log + test send
// ---------------------------------------------------------------------------
app.get('/api/email/status', auth, (req, res) => res.json({ configured: emailConfigured }));

app.get(
  '/api/email-log',
  auth,
  wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT recipient, subject, status, error, created_at FROM email_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.accountId]
    );
    res.json({ configured: emailConfigured, log: rows });
  })
);

app.post(
  '/api/email/test',
  auth,
  wrap(async (req, res) => {
    const me = (await query('SELECT email, name FROM users WHERE id = $1', [req.user.id])).rows[0];
    const r = await sendEmail({
      userId: req.accountId,
      to: me.email,
      subject: 'PanHost test email ✅',
      html: emailTemplate({
        heading: 'It works!',
        lines: ['This is a test email from PanHost. If you received it, your email delivery is configured correctly.'],
      }),
    });
    res.json(r);
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
    .replace(/\{\{trip\}\}/gi, booking.id ? `${PUBLIC_URL}/trip/${booking.id}` : '')
    .replace(/\{\{review\}\}/gi, booking.id ? `${PUBLIC_URL}/review/${booking.id}` : '');
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
    const result = await runAutomationsForUser(req.accountId);
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

// Daily: refresh cached market medians for every market-anchored listing.
async function scheduledMarketSweep() {
  if (!stayingApiConfigured()) return;
  try {
    const props = (await query(
      'SELECT id, address, city, country, bedrooms FROM properties WHERE market_anchor = true'
    )).rows;
    let ok = 0;
    for (const p of props) {
      try {
        await refreshMarketMedian(p);
        ok += 1;
      } catch (e) {
        console.error('[scheduler] market refresh failed for', p.id, e.message);
      }
    }
    if (ok > 0) console.log(`[scheduler] Refreshed market median for ${ok} listing(s).`);
  } catch (err) {
    console.error('[scheduler] market sweep failed:', err.message);
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
    const uid = req.accountId;
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
    const uid = req.accountId;
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
      query('SELECT id, name FROM properties WHERE user_id = $1 AND name ILIKE $2 LIMIT 5', [req.accountId, like]),
      query(
        `SELECT b.id, b.guest_name, b.check_in, p.name AS property_name
           FROM bookings b JOIN properties p ON p.id = b.property_id
          WHERE b.user_id = $1 AND (b.guest_name ILIKE $2 OR b.guest_email ILIKE $2) LIMIT 6`,
        [req.accountId, like]
      ),
      query('SELECT id, number, guest_name FROM invoices WHERE user_id = $1 AND (number ILIKE $2 OR guest_name ILIKE $2) LIMIT 4', [req.accountId, like]),
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
    const uid = req.accountId;
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
    const uid = req.accountId;
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
  ownerOnly,
  wrap(async (req, res) => {
    const { status } = req.query;
    const clauses = ['i.user_id = $1'];
    const vals = [req.accountId];
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
  ownerOnly,
  wrap(async (req, res) => {
    const { property_id, booking_id, guest_name, amount, due_date, notes } = req.body || {};
    if (amount === undefined) return res.status(400).json({ error: 'amount is required' });
    const number = await nextInvoiceNumber(req.accountId);
    const { rows } = await query(
      `INSERT INTO invoices (user_id, property_id, booking_id, number, guest_name, amount, due_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.accountId, property_id || null, booking_id || null, number, guest_name || null, amount, due_date || null, notes || null]
    );
    res.status(201).json(rows[0]);
  })
);

app.put(
  '/api/invoices/:id',
  auth,
  ownerOnly,
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
    vals.push(req.params.id, req.accountId);
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
  ownerOnly,
  wrap(async (req, res) => {
    const { rowCount } = await query('DELETE FROM invoices WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.accountId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ deleted: true });
  })
);

// Auto-generate invoices from confirmed reservations that don't have one yet.
app.post(
  '/api/invoices/generate',
  auth,
  ownerOnly,
  wrap(async (req, res) => {
    const { rows: bookings } = await query(
      `SELECT b.id, b.property_id, b.guest_name, b.total_amount, b.check_in
         FROM bookings b
         LEFT JOIN invoices i ON i.booking_id = b.id
        WHERE b.user_id = $1 AND b.status <> 'cancelled' AND i.id IS NULL AND b.total_amount > 0`,
      [req.accountId]
    );
    let created = 0;
    let seq = (await query('SELECT COUNT(*)::int AS n FROM invoices WHERE user_id = $1', [req.accountId]))
      .rows[0].n;
    for (const b of bookings) {
      seq += 1;
      await query(
        `INSERT INTO invoices (user_id, property_id, booking_id, number, guest_name, amount, due_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'unpaid')
         ON CONFLICT (user_id, booking_id) WHERE booking_id IS NOT NULL DO NOTHING`,
        [
          req.accountId,
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
  ownerOnly,
  wrap(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
      ? req.query.month
      : new Date().toISOString().slice(0, 7);

    const userRow = await query('SELECT mgmt_fee_pct FROM users WHERE id = $1', [req.accountId]);
    const feePct = Number(userRow.rows[0]?.mgmt_fee_pct || 0);

    const props = await query('SELECT id, name FROM properties WHERE user_id = $1', [req.accountId]);
    const bookings = await query(
      `SELECT property_id, total_amount, check_in FROM bookings
        WHERE user_id = $1 AND status <> 'cancelled'`,
      [req.accountId]
    );
    const expenses = await query(
      `SELECT property_id, amount, spent_on FROM expenses WHERE user_id = $1`,
      [req.accountId]
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
        statement_token: statementToken(p.id),
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
    let { rows } = await query('SELECT webhook_token FROM users WHERE id = $1', [req.accountId]);
    let token = rows[0]?.webhook_token;
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      await query('UPDATE users SET webhook_token = $1 WHERE id = $2', [token, req.accountId]);
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
    await query('UPDATE users SET webhook_token = $1 WHERE id = $2', [token, req.accountId]);
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
    if (propId) {
      // A caller-supplied property_id must belong to THIS account: otherwise a token
      // holder could inject bookings onto someone else's listing, blocking their real
      // availability via the public iCal feed and skewing their owner statement.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(propId));
      const owned = isUuid
        ? await query('SELECT id FROM properties WHERE id = $1 AND user_id = $2', [propId, userId])
        : { rows: [] };
      if (!owned.rows.length) return res.status(400).json({ error: 'Unknown property for this account' });
    }
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
  publicWriteLimiter,
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

// Public: per-property monthly owner statement (shareable read-only link).
app.get(
  '/api/public/owner-statement/:propertyId',
  wrap(async (req, res) => {
    // Requires the capability token — the bare property UUID is public (guidebook + iCal).
    const expected = statementToken(req.params.propertyId);
    const supplied = String(req.query.t || '');
    if (supplied.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(404).json({ error: 'Statement not found' });
    }
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const prop = (await query(
      `SELECT p.id, p.name, p.city, p.country, u.brand_name, u.company, u.brand_color, u.mgmt_fee_pct
         FROM properties p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
      [req.params.propertyId]
    )).rows[0];
    if (!prop) return res.status(404).json({ error: 'Statement not found' });
    const feePct = Number(prop.mgmt_fee_pct || 0);

    const inMonth = (col) => `to_char(${col}, 'YYYY-MM') = $2`;
    const gross = Number((await query(
      `SELECT COALESCE(SUM(total_amount),0)::float AS t FROM bookings WHERE property_id = $1 AND status <> 'cancelled' AND ${inMonth('check_in')}`,
      [prop.id, month]
    )).rows[0].t);
    const expRows = (await query(
      `SELECT category, COALESCE(SUM(amount),0)::float AS t FROM expenses WHERE property_id = $1 AND ${inMonth('spent_on')} GROUP BY category`,
      [prop.id, month]
    )).rows;
    const expenses = expRows.reduce((s, r) => s + Number(r.t), 0);
    const mgmtFee = Math.round((gross * feePct) / 100 * 100) / 100;
    const net = Math.round((gross - expenses - mgmtFee) * 100) / 100;

    res.json({
      property: prop.name,
      location: [prop.city, prop.country].filter(Boolean).join(', '),
      brand: prop.brand_name || prop.company || 'PanHost',
      brand_color: prop.brand_color,
      month,
      feePct,
      gross: Math.round(gross * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      expenseBreakdown: expRows.map((r) => ({ category: r.category, amount: Math.round(Number(r.t) * 100) / 100 })),
      mgmtFee,
      net,
    });
  })
);

// Public: guest submits a review from an emailed link.
app.get(
  '/api/public/review/:bookingId',
  wrap(async (req, res) => {
    const b = (await query(
      `SELECT b.guest_name, b.id, p.name AS property_name, u.brand_name, u.company, u.brand_color,
              (SELECT COUNT(*)::int FROM reviews r WHERE r.booking_id = b.id) AS reviewed
         FROM bookings b JOIN properties p ON p.id = b.property_id JOIN users u ON u.id = b.user_id
        WHERE b.id = $1`,
      [req.params.bookingId]
    )).rows[0];
    if (!b) return res.status(404).json({ error: 'Reservation not found' });
    res.json({
      guest_name: b.guest_name,
      property_name: b.property_name,
      brand: b.brand_name || b.company || 'PanHost',
      brand_color: b.brand_color,
      already: b.reviewed > 0,
    });
  })
);

app.post(
  '/api/public/review/:bookingId',
  publicWriteLimiter,
  wrap(async (req, res) => {
    const { rating, body } = req.body || {};
    const b = (await query('SELECT id, user_id, property_id, guest_name, platform FROM bookings b WHERE b.id = $1', [req.params.bookingId])).rows[0];
    if (!b) return res.status(404).json({ error: 'Reservation not found' });
    const exists = await query('SELECT id FROM reviews WHERE booking_id = $1', [b.id]);
    if (exists.rows.length) return res.status(409).json({ error: 'A review was already submitted for this stay. Thank you!' });
    const r = Math.min(5, Math.max(1, Number(rating) || 5));
    await query(
      `INSERT INTO reviews (user_id, property_id, booking_id, guest_name, platform, rating, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [b.user_id, b.property_id, b.id, b.guest_name, b.platform || 'direct', r, body || null]
    );
    res.status(201).json({ ok: true });
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

// Market medians refresh daily (a bit after boot).
setTimeout(scheduledMarketSweep, 90 * 1000);
const marketTimer = setInterval(scheduledMarketSweep, 24 * 60 * 60 * 1000);
marketTimer.unref?.();
automationTimer.unref?.();

// Graceful shutdown for containers / dev restarts.
function shutdown() {
  console.log('[server] Shutting down...');
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
