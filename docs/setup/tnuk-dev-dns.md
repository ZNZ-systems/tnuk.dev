# tnuk.dev DNS (Vercel)

1. Add domain in Vercel project (root directory: `web/`).
2. Configure DNS at your registrar:

| Type  | Name | Value              |
|-------|------|--------------------|
| A     | @    | 76.76.21.21        |
| CNAME | www  | cname.vercel-dns.com |

3. Clerk Dashboard → configure → **Allowed origins**: `https://tnuk.dev`
4. Clerk → **Redirect URLs**: include `https://tnuk.dev/cli-auth`, `https://tnuk.dev/device`, `https://tnuk.dev/billing`
5. Set `NEXT_PUBLIC_APP_URL=https://tnuk.dev` in Vercel production env.

For local dev: `TNUK_API_URL=http://localhost:3000` in the CLI shell.
