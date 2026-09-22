# API Reference

Base URL (local): `http://localhost:3001`

All endpoints return JSON. Protected endpoints require an `Authorization: Bearer <token>` header. Get a token from `/api/auth/register` or `/api/auth/login`.

## Auth

### POST /api/auth/register
Body: `{ "email", "password", "name?" }`
→ `201 { token, user: { id, email, name } }`

### POST /api/auth/login
Body: `{ "email", "password" }`
→ `200 { token, user }`

### GET /api/auth/me  🔒
→ `200 { id, email, name, created_at }`

## Properties 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/properties` | — |
| POST | `/api/properties` | `{ name*, address, city, country, bedrooms, bathrooms, max_guests, base_price, cleaning_fee, notes }` |
| PUT | `/api/properties/:id` | any subset of the above |
| DELETE | `/api/properties/:id` | — |

## Bookings 🔒

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/bookings` | Query filters: `property_id`, `platform`, `status` |
| POST | `/api/bookings` | `{ property_id*, guest_name*, guest_email, platform, check_in*, check_out*, guests, total_amount, status }` |
| PUT | `/api/bookings/:id` | any subset (except property_id) |
| DELETE | `/api/bookings/:id` | — |

`platform` ∈ `airbnb | vrbo | direct`. `status` ∈ `confirmed | pending | cancelled`.

## Credentials & Sync 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/credentials` | — (never returns tokens) |
| POST | `/api/credentials/airbnb` | `{ property_ref, access_token* }` |
| POST | `/api/credentials/vrbo` | `{ property_ref, access_token* }` |
| POST | `/api/sync/airbnb` | → `{ platform, fetched, imported }` |
| POST | `/api/sync/vrbo` | → `{ platform, fetched, imported }` |

If `AIRBNB_SYNC_URL` / `VRBO_SYNC_URL` are set, sync fetches live reservations from those partner endpoints; otherwise it imports deterministic sample bookings so the flow is testable.

## Pricing rules 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/pricing` | — |
| POST | `/api/pricing` | `{ property_id*, name*, start_date, end_date, price*, min_stay }` |
| DELETE | `/api/pricing/:id` | — |

## Expenses 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/expenses` | — |
| GET | `/api/expenses/categories` | → list of valid categories |
| POST | `/api/expenses` | `{ property_id, category*, description, amount*, spent_on }` |
| DELETE | `/api/expenses/:id` | — |

`category` ∈ `cleaning | maintenance | utilities | supplies | fees | insurance | other`.

## Messages 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/messages` | — |
| POST | `/api/messages` | `{ property_id, booking_id, guest_name, platform, direction, body* }` |

## Message templates 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/templates` | — |
| POST | `/api/templates` | `{ name*, body*, trigger, active }` |
| PUT | `/api/templates/:id` | any subset |
| DELETE | `/api/templates/:id` | — |

`trigger` ∈ `manual | booking_confirmed | before_checkin | after_checkout`. Bodies support `{{guest}}`, `{{property}}`, `{{checkin}}`, `{{checkout}}` placeholders.

## Tasks 🔒

| Method | Path | Body |
|--------|------|------|
| GET | `/api/tasks` | query filter: `status` |
| POST | `/api/tasks` | `{ title*, type, property_id, booking_id, assignee, due_date, notes, status }` |
| PUT | `/api/tasks/:id` | any subset |
| DELETE | `/api/tasks/:id` | — |
| POST | `/api/tasks/generate-turnovers` | → `{ created }` (auto-creates cleaning tasks from check-outs) |

`type` ∈ `cleaning | maintenance | check-in | check-out | other`. `status` ∈ `open | in_progress | done`.

## Calendar sync 🔒

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/sync/ical` | Fetches every listing's Airbnb/VRBO iCal URL and imports reservations → `{ fetched, imported, detail, errors }` |

## Dashboard & analytics 🔒

### GET /api/dashboard
→ `{ properties, bookings, upcoming, nightsBooked, revenue, expenses, profit, byPlatform }`

### GET /api/analytics
→ `{ properties, totalRevenue, totalNights, adr, occupancy, revpar, series[] }` (occupancy = next-90-day forward-looking; `series` is 6 months of `{ label, revenue, expenses }`)

## Health

### GET /api/health
→ `{ status: "ok", service, time }`

## Examples

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"host@example.com","password":"secret123","name":"Jane"}'

# Use the token
TOKEN=... # from the response above
curl http://localhost:3001/api/properties -H "Authorization: Bearer $TOKEN"
```

```javascript
// JavaScript (fetch)
const res = await fetch('http://localhost:3001/api/properties', {
  headers: { Authorization: `Bearer ${token}` },
});
const properties = await res.json();
```
