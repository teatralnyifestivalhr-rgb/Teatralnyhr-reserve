# HR Reserve: cloud setup

This app can run in two modes:

- Local test mode: SQLite file in `data/hr-reserve.sqlite`.
- Cloud mode: Supabase/Postgres via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## 1. Create Supabase database

1. Create a free Supabase project.
2. Open SQL Editor.
3. Run `supabase-schema.sql` from this repository.
4. Copy:
   - Project URL -> `SUPABASE_URL`
   - Service role key -> `SUPABASE_SERVICE_ROLE_KEY`

Keep the service role key private. Do not put it into frontend code.

## 2. Deploy the app

Use a Node hosting provider that can run a long-running server, for example Render.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
HR_RESERVE_PASSWORD=shared-password-for-two-hr
SESSION_SECRET=long-random-secret
```

Optional integrations:

```text
HH_CLIENT_ID=...
HH_CLIENT_SECRET=...
HH_REDIRECT_URI=https://your-cloud-domain/api/hh/callback
AVITO_CLIENT_ID=...
AVITO_CLIENT_SECRET=...
```

## 3. How two HR users work

Both HR users open the same cloud URL and enter the shared `HR_RESERVE_PASSWORD`.
All candidates are stored in Supabase, so both users see the same database.

## 4. Local fallback

Without Supabase variables the app still runs locally:

```powershell
npm.cmd start
```

Then open:

```text
http://localhost:3000
```
