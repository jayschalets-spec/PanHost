# Root Dockerfile for Render.
# Render's default build looks for ./Dockerfile with the repo root as the build
# context, so this builds the backend from here rather than requiring a
# "Root Directory" override in the dashboard. (backend/Dockerfile is kept for
# running the backend on its own, e.g. via docker-compose.)
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm install --omit=dev

COPY backend/ ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
