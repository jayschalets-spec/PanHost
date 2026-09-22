# Deploy PanHost live (free tier)

Three free services: **Supabase** (database), **Render** (backend API), **Vercel** (frontend). ~15 minutes. The database schema applies itself on first boot — no manual SQL step.

## 0. Push the code to GitHub
The repo is already committed locally. Create an empty GitHub repo (e.g. `panhost`), then:

```bash
cd OTAApp
git remote add origin https://github.com/YOUR_USERNAME/panhost.git
git branch -M main
git push -u origin main
```

## 1. Database — Supabase (free)
1. supabase.com → New project (pick a region, set a DB password).
2. Project Settings → **Database** → **Connection string** → **URI**. Copy it and put your password in.
   - Use the **Session/Pooler** URI (port 6543 or 5432). It looks like
     `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres`.
3. That's it — PanHost creates its tables automatically on first backend boot.

## 2. Backend — Render (free)
1. render.com → **New +** → **Blueprint**, connect your GitHub repo. Render reads `render.yaml`.
   - (Or **New Web Service** → root dir `backend`, build `npm install`, start `npm start`.)
2. Set env vars:
   - `DATABASE_URL` = your Supabase URI
   - `JWT_SECRET` = auto-generated (or any long random string)
   - `NODE_ENV` = `production`
   - `PUBLIC_URL` = your Vercel URL (fill after step 3; used for guest trip/guidebook links)
3. Deploy. Copy the service URL, e.g. `https://panhost-backend.onrender.com`.
   - Verify: open `https://panhost-backend.onrender.com/api/health` → `{"status":"ok"}`.

## 3. Frontend — Vercel (free)
1. vercel.com → **Add New → Project**, import the repo.
2. **Root Directory:** `frontend`. Framework auto-detects **Vite** (`vercel.json` handles SPA routing).
3. Env var: `VITE_API_URL` = your Render backend URL (from step 2).
4. Deploy. Your app is live at `https://<project>.vercel.app`.
5. Go back to Render and set `PUBLIC_URL` to this Vercel URL, then redeploy the backend so guest links use your real domain.

## 4. Go live
- Open your Vercel URL, register, and you're running in production.
- Free-tier note: Render sleeps after ~15 min idle (first request wakes it in ~30s). Upgrade to Hobby ($7/mo) to keep it warm.

## Custom domain (optional)
Add your domain in Vercel (frontend) and Render (backend), then update `VITE_API_URL` and `PUBLIC_URL` accordingly.
