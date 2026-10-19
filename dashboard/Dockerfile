# Builds the Clayver dashboard and serves it with nginx.
# Build from the repository root (the dashboard is part of a pnpm workspace):
#
#   docker build -f dashboard/Dockerfile -t clayver-dashboard \
#     --build-arg VITE_FIREBASE_API_KEY=... \
#     --build-arg VITE_FIREBASE_AUTH_DOMAIN=... \
#     --build-arg VITE_FIREBASE_PROJECT_ID=... \
#     --build-arg VITE_FIREBASE_DATABASE_URL=... \
#     --build-arg VITE_FIREBASE_STORAGE_BUCKET=... \
#     --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=... \
#     --build-arg VITE_FIREBASE_APP_ID=... \
#     --build-arg VITE_FIREBASE_VAPID_KEY=... \
#     .
#   docker run -p 8080:8080 clayver-dashboard
#
# Alternatively put the values in dashboard/.env.production.local before building.
# Vite inlines VITE_* values at build time; they are public web config, not secrets.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@clayver/dashboard..."

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_DATABASE_URL
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_VAPID_KEY
ARG VITE_CLAYVER_PROJECT_ID=default
ARG VITE_CLAYVER_FUNCTIONS_REGION=us-central1
RUN pnpm --filter @clayver/dashboard build

FROM nginx:1.27-alpine
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/dashboard/dist /usr/share/nginx/html
EXPOSE 8080
