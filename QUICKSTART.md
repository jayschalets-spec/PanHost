# Quick Start Guide - 30 Minutes to Live

Get your Property Manager SaaS running locally or deployed to the cloud.

## Option 1: Local Development (10 minutes)

### Prerequisites
- Node.js 18+ installed
- PostgreSQL installed (or Docker)
- Git

### Steps

```bash
# 1. Clone the repo
git clone <your-repo> property-mgmt
cd property-mgmt

# 2. Run setup script
chmod +x setup.sh
./setup.sh

# 3. Update environment variables
# Backend
cd backend
nano .env  # or open in your editor
# Set: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/property_mgmt

# Frontend
cd ../frontend
nano .env
# Set: VITE_API_URL=http://localhost:3001

# 4. Start backend
cd ../backend
npm run dev
# Backend should be running on http://localhost:3001

# 5. In a NEW terminal, start frontend
cd frontend
npm run dev
# Frontend should be running on http://localhost:3000
```

### Test It
1. Open http://localhost:3000
2. Click "Register"
3. Create account
4. Add a property
5. Done! ✅

---

## Option 2: Deploy to Cloud (20 minutes)

### What You'll Need
1. GitHub account (for code hosting)
2. Supabase account (free PostgreSQL)
3. Render account (free backend hosting)
4. Vercel account (free frontend hosting)

### Step 1: Push Code to GitHub

```bash
# 1. Initialize git repo
git init
git add .
git commit -m "Initial commit"

# 2. Create GitHub repo at github.com/new
# Name it "property-mgmt-saas"

# 3. Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/property-mgmt-saas.git
git branch -M main
git push -u origin main
```

### Step 2: Set Up Supabase Database

1. Go to [supabase.com](https://supabase.com)
2. Sign up → Create Project
3. Wait for project to initialize
4. Go to "SQL Editor" tab
5. Click "New Query"
6. Copy/paste contents of `backend/schema.sql`
7. Click "Run"
8. In "Settings" → "Database", copy your connection string

### Step 3: Deploy Backend to Render

1. Go to [render.com](https://render.com)
2. Sign up → Dashboard
3. Click "New +" → "Web Service"
4. Connect GitHub
5. Select your repo
6. Fill in:
   - **Name:** `property-mgmt-backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install --prefix backend`
   - **Start Command:** `npm start --prefix backend`
7. Add Environment Variables:
   ```
   DATABASE_URL = <your-supabase-connection-string>
   JWT_SECRET = generate-a-random-string-here (use: openssl rand -hex 32)
   NODE_ENV = production
   ```
8. Click "Create Web Service"
9. Wait ~3 minutes for deployment
10. Copy your URL (e.g., https://property-mgmt-backend.onrender.com)

### Step 4: Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign up → Dashboard
3. Click "Add New..." → "Project"
4. Import your GitHub repo
5. Set Framework: "Vite"
6. Set Root Directory: `frontend`
7. Add Environment:
   ```
   VITE_API_URL = <your-render-url>
   ```
   Example: `https://property-mgmt-backend.onrender.com`
8. Click "Deploy"
9. Wait ~2 minutes
10. Your app is live!

### Step 5: Test Live App

1. Visit your Vercel URL (shown after deployment)
2. Register account
3. Add property
4. Celebrate! 🎉

---

## Common Issues & Fixes

### "Cannot connect to database"
- Verify DATABASE_URL is correct
- Check Supabase project is running
- Wait 1 minute after creating Supabase project

### "CORS error" or "Cannot reach API"
- Verify VITE_API_URL is set correctly in Vercel
- Check backend is running on Render
- Redeploy frontend after updating env var

### "Port already in use"
```bash
# Kill process using port 3001
lsof -ti:3001 | xargs kill -9

# Or change port in backend .env
PORT=3002
```

### Render backend sleeping
- Render puts free tier to sleep after 15 min of inactivity
- Upgrade to Hobby plan ($7/month) to keep it running
- Or make a request every 14 minutes to keep alive

---

## Next Steps

### For Your Properties

1. **Add Your Properties**
   - Go to "Properties" tab
   - Add your 2-5 properties
   - Fill in beds, baths, max guests

2. **Get Airbnb Credentials**
   - Visit https://airbnb.com/developer
   - Create app → Generate API key
   - Copy property ID + access token

3. **Get VRBO Credentials**
   - Visit https://vrbo.com/developer
   - Create app → Generate API key
   - Copy property ID + access token

4. **Connect in Settings**
   - Go to "Settings"
   - Add Airbnb credentials
   - Add VRBO credentials
   - Your bookings will sync!

### For Monetization

1. **White Label for Clients**
   - Change logo/colors (in frontend)
   - Deploy as separate instance
   - Charge $500-2000/month

2. **Sell as SaaS**
   - Add Stripe payments
   - Create pricing page
   - Market to property managers
   - Target: $30-99/month per user

3. **Both**
   - Run your own properties
   - Sell to others
   - Passive income stream

---

## File Structure

```
property-mgmt-app/
├── backend/              # Node.js + Express API
│   ├── server.js        # Main server
│   ├── schema.sql       # Database schema
│   └── package.json
├── frontend/            # React SPA
│   ├── src/
│   │   ├── pages/       # Page components
│   │   ├── components/  # Reusable components
│   │   └── App.jsx      # Main app
│   └── package.json
├── DEPLOYMENT.md        # Full deployment guide
├── API.md              # API documentation
├── README.md           # Project overview
└── QUICKSTART.md       # This file
```

---

## Features Included

✅ User authentication
✅ Multi-property management
✅ Unified booking calendar
✅ Airbnb & VRBO sync
✅ Pricing management
✅ Expense tracking
✅ Financial dashboard
✅ Guest messaging
✅ Revenue reporting
✅ Multi-tenant architecture (ready for SaaS)

---

## Getting Help

### Documentation
- [Full API Docs](./API.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [README](./README.md)

### Common Queries

**Q: Can I add more features?**
A: Yes! It's open source. Modify the code however you want.

**Q: How do I make this white-label?**
A: Change colors/logo in frontend, deploy as separate instance.

**Q: Can I sell this to property managers?**
A: Yes! That's the goal. Add Stripe payments and market it.

**Q: How much does it cost to run?**
A: Free tier = $0/month. Upgrade Render to $7/month when you scale.

**Q: How do I backup my data?**
A: Supabase auto-backs up. Enable backups in settings.

---

## Success Metrics

After deployment, you should see:

- ✅ Login page working
- ✅ Dashboard loading data
- ✅ Properties page shows your listings
- ✅ Can add properties
- ✅ Settings page displays API forms
- ✅ No red errors in console

---

## What's Next?

1. **Week 1:** Add your properties and connect APIs
2. **Week 2:** Verify bookings are syncing
3. **Week 3:** Optimize pricing and track expenses
4. **Week 4:** Beta test with 1-2 other property managers
5. **Month 2:** Launch to market

---

**Ready? Let's go! 🚀**
