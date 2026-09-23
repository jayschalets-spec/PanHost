-- Property Manager SaaS - Database Schema
-- PostgreSQL 13+
-- Multi-tenant: every row is scoped to a user (owner).

-- gen_random_uuid() is part of core PostgreSQL (13+), so no extension needed.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT,  -- NULL until a pending invite is accepted
    name          TEXT,
    company       TEXT,
    brand_name    TEXT,
    brand_color   TEXT,
    mgmt_fee_pct  NUMERIC(5,2) DEFAULT 0,
    currency      TEXT DEFAULT 'USD',
    webhook_token TEXT,
    owner_id      UUID,                       -- NULL = account owner; else the owner this staff belongs to
    role          TEXT NOT NULL DEFAULT 'owner', -- owner | co-host | cleaner | maintenance
    invite_token  TEXT,
    invite_status TEXT,                        -- pending | active
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_status TEXT;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS brand_color TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mgmt_fee_pct NUMERIC(5,2) DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';

-- ---------------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    address      TEXT,
    city         TEXT,
    country      TEXT,
    bedrooms     INTEGER DEFAULT 1,
    bathrooms    NUMERIC(3,1) DEFAULT 1,
    max_guests   INTEGER DEFAULT 2,
    base_price   NUMERIC(10,2) DEFAULT 0,
    cleaning_fee NUMERIC(10,2) DEFAULT 0,
    description  TEXT,
    amenities    TEXT,               -- comma-separated list
    photos       TEXT,               -- one image URL per line
    airbnb_ical_url TEXT,
    vrbo_ical_url   TEXT,
    booking_com_ical_url TEXT,
    airbnb_listing_id TEXT,
    wifi_name    TEXT,
    wifi_password TEXT,
    checkin_time TEXT,
    checkout_time TEXT,
    house_rules  TEXT,
    guidebook    TEXT,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_properties_user ON properties(user_id);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS wifi_name TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS wifi_password TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS checkin_time TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS checkout_time TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS house_rules TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS guidebook TEXT;
-- Idempotent upgrades for databases created before these columns existed.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS amenities TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS photos TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS airbnb_ical_url TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS vrbo_ical_url TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS booking_com_ical_url TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS airbnb_listing_id TEXT;

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    guest_name    TEXT NOT NULL,
    guest_email   TEXT,
    platform      TEXT NOT NULL DEFAULT 'direct', -- airbnb | vrbo | direct
    external_id   TEXT,                            -- id on the source platform (for sync dedupe)
    check_in      DATE NOT NULL,
    check_out     DATE NOT NULL,
    guests        INTEGER DEFAULT 1,
    total_amount  NUMERIC(10,2) DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | pending | cancelled
    door_code     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS door_code TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_property ON bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(check_in, check_out);
-- Prevent duplicate imports of the same external booking.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bookings_external
    ON bookings(user_id, platform, external_id)
    WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- api_credentials (Airbnb / VRBO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_credentials (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     TEXT NOT NULL,           -- airbnb | vrbo
    property_ref TEXT,                     -- platform property/listing id
    access_token TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON api_credentials(user_id);

-- ---------------------------------------------------------------------------
-- messages (guest communication)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
    guest_name  TEXT,
    platform    TEXT DEFAULT 'direct',
    direction   TEXT NOT NULL DEFAULT 'incoming', -- incoming | outgoing
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);

-- ---------------------------------------------------------------------------
-- pricing_rules (seasonal / rules-based pricing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'seasonal', -- seasonal | weekend | lastminute
    start_date  DATE,
    end_date    DATE,
    price       NUMERIC(10,2),      -- fixed nightly price (when adjust = fixed)
    adjust      TEXT DEFAULT 'fixed', -- fixed | percent
    percent     NUMERIC(6,2),        -- +/- percent (when adjust = percent)
    min_stay    INTEGER DEFAULT 1,
    priority    INTEGER DEFAULT 0,   -- higher applies later (wins)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pricing_user ON pricing_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_pricing_property ON pricing_rules(property_id);
ALTER TABLE pricing_rules ALTER COLUMN price DROP NOT NULL;
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'seasonal';
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS adjust TEXT DEFAULT 'fixed';
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS percent NUMERIC(6,2);
ALTER TABLE pricing_rules ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    category    TEXT NOT NULL,   -- cleaning | maintenance | utilities | supplies | fees | insurance | other
    description TEXT,
    amount      NUMERIC(10,2) NOT NULL,
    spent_on    DATE NOT NULL DEFAULT CURRENT_DATE,
    receipt_url TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;
CREATE INDEX IF NOT EXISTS idx_expenses_property ON expenses(property_id);

-- ---------------------------------------------------------------------------
-- message_templates (canned replies + automation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    body        TEXT NOT NULL,
    trigger     TEXT NOT NULL DEFAULT 'manual', -- manual | booking_confirmed | before_checkin | after_checkout
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON message_templates(user_id);

-- ---------------------------------------------------------------------------
-- tasks (turnovers, maintenance, to-dos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'cleaning', -- cleaning | maintenance | check-in | check-out | other
    assignee    TEXT,
    due_date    DATE,
    status      TEXT NOT NULL DEFAULT 'open',     -- open | in_progress | done
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_property ON tasks(property_id);

-- ---------------------------------------------------------------------------
-- invoices (automated billing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
    number      TEXT NOT NULL,
    guest_name  TEXT,
    amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid | void
    issued_on   DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date    DATE,
    paid_on     DATE,
    payment_url TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_url TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoice_booking
    ON invoices(user_id, booking_id) WHERE booking_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- reviews (guest reviews across channels)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    booking_id  UUID REFERENCES bookings(id) ON DELETE SET NULL,
    guest_name  TEXT,
    platform    TEXT NOT NULL DEFAULT 'direct',
    rating      INTEGER NOT NULL DEFAULT 5,   -- 1..5
    body        TEXT,
    response    TEXT,
    reviewed_on DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);

-- ---------------------------------------------------------------------------
-- team_members (staff roster: cleaners, co-hosts, owners)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    role        TEXT NOT NULL DEFAULT 'cleaner', -- cleaner | co-host | owner | maintenance
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_user ON team_members(user_id);

-- ---------------------------------------------------------------------------
-- email_log (transactional email history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    recipient   TEXT,
    subject     TEXT,
    body        TEXT,
    status      TEXT NOT NULL DEFAULT 'logged', -- sent | logged | failed
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_log_user ON email_log(user_id);
