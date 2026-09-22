# PropManager — Property Management SaaS

A Hostaway-style property management system for Airbnb, VRBO, and direct bookings. Manage listings, reservations, a unified guest inbox, pricing, tasks, finances, and analytics from one dashboard.

Built as a full-stack app: **React + Vite** frontend, **Node + Express + PostgreSQL** backend, multi-tenant and deployable free.

---

## ✨ Features

| Area | What it does |
|------|--------------|
| **Dashboard** | KPI cards (all clickable), revenue-by-platform, next check-in countdown, upcoming table |
| **Unified Inbox** | Threaded guest conversations across Airbnb/VRBO/direct, canned-reply templates, email for direct guests |
| **Listings** | Rich listings with photos (gallery view), description, amenities, per-listing iCal URLs |
| **Reservations** | Full CRUD, platform/status filters, one-click "Message guest" |
| **Calendar** | Unified month view of availability across all platforms |
| **Tasks** | Kanban board (Open / In progress / Done) with auto-generated cleaning turnovers |
| **Pricing** | Seasonal rate rules with minimum-stay |
| **Finances** | Revenue, expenses (7 categories) with per-category breakdown, profit & margin |
| **Analytics** | Occupancy, ADR, RevPAR, nights sold, 6-month revenue-vs-expense chart |
| **Automations** | Message templates with triggers (booking confirmed, before check-in, after check-out) |
| **Calendar sync** | Real iCal import from Airbnb/VRBO listing calendars (no partner approval needed) |

Multi-tenant (every record scoped to the owner), JWT auth, and built to resell as SaaS.

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
