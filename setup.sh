#!/usr/bin/env bash
# One-shot local setup: installs deps and creates .env files from templates.
set -e

echo "==> Property Manager SaaS setup"

echo "==> Installing backend dependencies..."
( cd backend && npm install )
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "    Created backend/.env (edit DATABASE_URL and JWT_SECRET)"
fi

echo "==> Installing frontend dependencies..."
( cd frontend && npm install )
if [ ! -f frontend/.env ]; then
  cp frontend/.env.example frontend/.env
  echo "    Created frontend/.env"
fi

cat <<'EOF'

==> Setup complete!

Next steps:
  1. Start the backend (no database needed — it runs an in-process Postgres):
       cd backend && npm run dev        # http://localhost:3001
  2. In a new terminal, start the frontend:
       cd frontend && npm run dev       # http://localhost:3000
  3. Open http://localhost:3000 and register.

To use a hosted Postgres/Supabase instead, set DATABASE_URL in backend/.env,
then run `cd backend && npm run initdb` once before starting.

EOF
