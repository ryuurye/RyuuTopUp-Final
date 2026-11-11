# Environment variable map

## Cloudflare Worker — server only

| Name | Kind | Required | Purpose |
|---|---|---:|---|
| `SUPABASE_URL` | Variable | yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Variable | yes | Supabase public API key, used only as project API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | yes | Server-side database access; never expose |
| `MELO_API_KEY` | Secret | yes | Melo H2H auth |
| `MELO_SECRET_KEY` | Secret | yes | Melo H2H auth |
| `MELO_WEBHOOK_SECRET` | Secret | yes | Melo callback HMAC |
| `MIDTRANS_SERVER_KEY` | Secret | yes | Snap create/status/refund API |
| `MIDTRANS_IS_PRODUCTION` | Variable | yes | `false` for Sandbox, `true` for live |
| `MELO_SANDBOX_MODE` | Variable | yes | `true` for safe provider simulation |
| `APP_URL` | Variable | yes | Netlify URL used for CORS/redirects |
| `DEFAULT_MARGIN_PERCENT` | Variable | no | defaults to `10` |
| `STORE_NAME` | Variable | no | defaults to `RyuuTopUp` |

## Netlify — public build-time settings only

| Name | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Cloudflare Worker origin |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `VITE_MIDTRANS_CLIENT_KEY` | Midtrans client key for Snap.js |
| `VITE_MIDTRANS_IS_PRODUCTION` | `false` for sandbox |

Never set `SUPABASE_SERVICE_ROLE_KEY`, `MIDTRANS_SERVER_KEY`, or any Melo secret in Netlify.
