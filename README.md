# PanHost — Property Management SaaS

A Hostaway-class property management system for Airbnb, VRBO, Booking.com, and direct bookings — with PriceLabs-style dynamic pricing and live market data. Manage everything from one branded dashboard.

Full-stack: **React + Vite** frontend, **Node + Express + PostgreSQL** backend. Multi-tenant with staff logins, dark mode, mobile-ready, deployable free.

---

## ✨ Features

| Area | What it does |
|------|--------------|
| **Dashboard** | Operational "today" cards (check-ins/outs, staying, approvals), clickable KPIs, revenue-by-platform, onboarding wizard |
| **Unified Inbox** | Threaded guest conversations across channels, canned templates, **AI reply suggestions**, email for direct guests |
| **Listings** | Photos + gallery, amenities, description, guidebook, per-channel iCal URLs; **StayingAPI content import** |
| **Reservations** | CRUD, date/guest filters, bulk actions, CSV import/export, detail drawer, guest trip links |
| **Guests CRM** | Profiles, stay history, lifetime value, VIP flags |
| **Calendar** | Month + multi-listing **timeline**, click-to-create |
| **Channel Manager** | Multi-channel connections, **double-booking conflict detection**, outbound availability iCal feed, official-API scaffolding |
| **Pricing** | **Dynamic pricing** — market-anchored + demand (occupancy/lead-time), seasonal & weekend rules, %/fixed, min-price floor, min-stays, live price calendar |
| **Market** | Live comparable listings by proximity (via StayingAPI): median/avg/range, suggested rate |
| **Reviews / Tasks / Team / Smart Locks / Finances / Billing / Statements / Analytics / Automations** | Full modules — kanban turnovers, door codes, invoices + pay links, owner P&L, KPIs, scheduled auto-messages |
| **Guest experience** | Public booking site, guest trip portal, digital guidebook, review-request loop |
| **Integrations** | iCal two-way sync, StayingAPI (listing data/market), Zapier inbound webhook, transactional email (SMTP), partner-API ready |

Multi-tenant with role-scoped **staff logins** (owner / co-host / cleaner / maintenance), JWT auth, white-label branding + multi-currency.

> **Honest integration note:** Airbnb/VRBO have no public API for individuals; official two-way sync requires approved partner status. PanHost ships iCal sync (works today), a Zapier email→webhook path, StayingAPI for listing/market data, and a partner-API client that activates the moment you add credentials.

---

## 🚀 Quick start (zero setup)

No database to install — the backend runs an in-process PostgreSQL (PGlite) by default, persisted to `backend/.localdb`.

```bash
# Backend
cd backend && npm install && npm run dev      # http://localhost:3001

# Frontend (new terminal)
cd frontend && npm install && npm run dev      # http://localhost:3000
```

Open http://localhost:3000 and register.

### Using a real Postgres / Supabase

Set `DATABASE_URL` in `backend/.env`, then run the schema once:

```bash
cd backend && npm run initdb
```

See [QUICKSTART.md](./QUICKSTART.md); deploy configs are in `render.yaml` and `frontend/vercel.json`.

---

## 📡 Connecting Airbnb & VRBO

**Reservations (works today, no approval):**
1. In Airbnb: *Listing → Availability → Sync calendars → Export calendar* — copy the `.ics` URL.
2. In PropManager: open the listing → paste it into **Airbnb iCal URL** → save.
3. **Settings → Calendar sync → Sync all calendars.** Reservations import automatically (deduped).

**Listing content (photos/description/amenities):** Airbnb has no public content API for individuals. Enter it in the app, or import from your own listing page/host editor. It cannot be pushed *back* to Airbnb (that needs partner API access) — edit the live listing on Airbnb directly.

---

## 🧱 Tech stack

- **Frontend:** React 18, React Router, Vite, Axios, date-fns
- **Backend:** Node 18+, Express, PostgreSQL (`pg`) or PGlite (zero-setup), JWT, bcrypt
- **Deploy:** Vercel (frontend), Render (backend), Supabase (DB) — all free tier

## 📚 Docs

- [QUICKSTART.md](./QUICKSTART.md) — local & cloud setup
- [API.md](./API.md) — full endpoint reference

## License

MIT — customize and resell freely.
