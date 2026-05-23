# Cursor service-account key rotation

The team service-account key lives in Vercel env as `CURSOR_API_KEY` (production only).

## Scheduled rotation (quarterly)

1. Cursor Dashboard → Team Settings → Service accounts → rotate key.
2. Update `CURSOR_API_KEY` in Vercel project settings (Production).
3. Redeploy `web/` (or trigger empty deploy).
4. Verify: `tnuk login` + `tnuk review` on a test repo.

## Emergency rotation (suspected leak)

1. Rotate immediately in Cursor dashboard (invalidates old key).
2. Update Vercel env + redeploy within minutes.
3. Audit `runs` table for anomalous volume by user.
4. Optionally invalidate all CLI JWTs by rotating `CLI_JWT_SECRET` (forces re-login).

## What users experience

- In-flight reviews may fail once with a retryable SDK error; next push succeeds.
- No CLI reinstall required.
