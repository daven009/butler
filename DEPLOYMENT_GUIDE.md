# Deployment Notes

This document captures how to deploy Butler from a fresh checkout — both for
local development and the Aliyun production VM.

The app now uses **Supabase** for auth + data (no more local JSON files for
business data). You must have a Supabase project and three keys before
deploying.

---

## Prerequisites (one-time)

1. **Supabase project** — region: Singapore. Run `backend/supabase/schema.sql`
   in the SQL Editor once. Confirm Authentication → Providers → Email is
   enabled and "Confirm email" is OFF for internal testing.
2. **OpenAI API key** — for listing parser + slot extractor.
3. **OneMap account** — register at https://www.onemap.gov.sg/apidocs/register.

---

## Local development

```bash
# 1. Clone + install (npm workspaces — installs both backend and web)
git clone <repo>
cd appointment_scheduler
npm install

# 2. Configure env files
cp backend/.env.example backend/.env       # then fill in the values
cp web/.env.example web/.env.local         # then fill in VITE_* values

# 3. Run backend + web (in two terminals)
cd backend && npm run dev      # → http://localhost:8787
cd web     && npm run dev      # → http://localhost:5173

# 4. Optional — load the unpacked Chrome extension
# chrome://extensions → Developer mode ON → Load unpacked → select extension/
# Note the assigned ID, then in butler-web devtools console:
#   localStorage.setItem('butler.extensionId', '<that id>')
```

### First sign-in
The web app shows a Sign in / Sign up form. Use any email + ≥6 char password.
With "Confirm email" OFF, you're signed in immediately.

---

## Aliyun production deployment

### One-time setup on the VM

```bash
# Install docker + compose plugin if not already present
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin

# Clone
cd /opt
sudo git clone https://github.com/<owner>/butler.git
sudo chown -R $USER:$USER butler
cd butler

# Configure secrets (NEVER commit this file)
cp backend/.env.example backend/.env
nano backend/.env   # paste real values
# Also, the docker-compose.yml reads SUPABASE_URL/SUPABASE_ANON_KEY at build
# time. Symlink or copy backend/.env to ./.env so docker-compose sees them:
cp backend/.env .env
```

### Build + run

```bash
docker compose build      # rebuild image with current source
docker compose up -d      # start in background
docker compose logs -f    # tail logs
```

Health check:
```bash
curl -i http://localhost:3080/health   # expect 200
curl -i http://localhost:3080/api/plans  # expect 401 (no auth token)
```

### nginx fronting

The container exposes port `3080` on the loopback interface only. Use the
host nginx config in `deploy/nginx-host.conf` to reverse-proxy `:443` →
`127.0.0.1:3080`.

### Update / redeploy

```bash
cd /opt/butler
git pull
docker compose build
docker compose up -d
```

---

## What's tracked in Supabase vs. local files

| Data | Where |
|---|---|
| Users (auth) | `auth.users` |
| Plans / tours / listings | `public.plans` etc. (per-user via RLS) |
| Conversations / routes / scheduling runs | same |
| PG raw listings cache | `public.pg_listings_archive` (cross-user, admin-only) |
| **Geocoding cache** | `backend/data/geocode-cache.json` (still local — TODO move to DB) |
| **PG scrape result archive** | `backend/data/pg-listings.json` (still local — TODO move to DB) |
| **Legacy butler/clients/tours/settings** | `backend/data/*.json` (old features still on JSON) |

The legacy local files are harmless — RLS-protected business data is in
Supabase. Future migrations will fold the remaining caches into DB tables.

---

## Chrome extension

- Local development: load unpacked from `extension/`
- Web Store: ID `melnenopfkellcalpdbopiickpmidjld` — currently published as
  v1.0.1 unlisted. The published version does NOT yet have the
  `STORE_TOKEN` Supabase JWT handshake added in this branch — bump to 1.0.2
  and resubmit when ready.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `health: 401` | Frontend hit `/api/...` without a valid Supabase JWT — sign in first. |
| `[scheduler] OneMap token unavailable` | `ONEMAP_*` env not loaded by the container. Check `docker compose config` shows them. |
| `[ext-import] llm parsing failed: OPENAI_API_KEY...` | Same — env not propagated. |
| Web app blank / "Missing VITE_SUPABASE_URL" | Image was built without `--build-arg VITE_SUPABASE_URL=...`. Rebuild after putting `.env` in place. |
| Sign-up succeeds but "Email not confirmed" | Toggle OFF in Supabase Dashboard → Auth → Providers → Email → Confirm email; or run `update auth.users set email_confirmed_at = now() where email = '...'` |
