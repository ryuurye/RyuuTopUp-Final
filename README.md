# RyuuTopUp — Final deployment package

Marketplace top-up frontend (Netlify), backend API + webhook receiver (Cloudflare Workers), and database (Supabase).

## Project status and important boundary

This package is a complete deployment-ready implementation, but it is **not connected to your live accounts yet**. The owner must add credentials in the provider dashboards and deploy the code. No assistant can safely log into your private Netlify, Cloudflare, Supabase, Melo, or Midtrans accounts without an authorized connected session. Never send secret keys in chat or commit them to Git.

Default integration mode:
- Midtrans: Sandbox
- Melo H2H: `sandbox_mode: true`
- Default selling margin: 10%

Do not switch to live mode until your Midtrans merchant account has been activated and its refund/payment-method capabilities are confirmed.

## Folder layout

- `frontend/` — Vite + React storefront and admin view
- `worker/` — Cloudflare Worker API, Midtrans/Melo webhook handlers
- `supabase/001_schema.sql` — isolated `rt_` schema, RLS policies, indexes, atomic fulfillment claim, product inquiry fields, and Melo action state
- `docs/DEPLOYMENT_ID.md` — step-by-step Indonesian deployment instructions
- `docs/ENVIRONMENT.md` — environment variable checklist

## Required account values

Public values (safe to put in Netlify build variables):
- Supabase Project URL
- Supabase anon/publishable key
- Midtrans Sandbox Client Key
- Cloudflare Worker base URL

Server-only secrets (Cloudflare Worker Secrets only):
- Supabase service-role key
- Melo API Key, Secret Key, Webhook Secret
- Midtrans Server Key

## Commands

Frontend:
```bash
cd frontend
npm install
npm run build
```

Worker:
```bash
cd worker
npm install
npx wrangler deploy
```

## Important operational notes

1. Create/confirm the Supabase schema before connecting the frontend.
2. Deploy the Worker before configuring webhook URLs.
3. Configure Melo callback to `https://YOUR-WORKER.workers.dev/api/webhooks/melo`.
4. Configure Midtrans Payment Notification URL to `https://YOUR-WORKER.workers.dev/api/webhooks/midtrans`.
5. Register a user through the storefront, then promote that account to admin using the SQL in `docs/DEPLOYMENT_ID.md`.
6. Use the admin menu to synchronize the Melo catalogue. The Worker validates the SKU and price from the database at checkout; it does not trust a frontend-supplied price.
7. Customer refunds are requests, not instant credits. The Worker submits an API refund to Midtrans when supported; unsupported payment methods require manual refund from the Midtrans dashboard/bank transfer. The order is only marked refunded after confirmation.

## Deliberate safeguards

- RLS protects customer rows; users cannot write order/payment/fulfillment status directly.
- Worker authenticates Supabase users and checks admin role server-side.
- Midtrans notification signature and server-side transaction status are verified.
- Melo webhook signature is verified against the raw request body.
- Provider fulfillment is claimed atomically in PostgreSQL to reduce duplicate orders.
- Melo requests reuse the stable order reference (`buyer_trx_id`) for reconciliation.
- An ambiguous provider timeout is sent to `manual_review`, not retried with a new provider reference.


**Melo account caveat:** if account IP whitelist is enabled, confirm the backend egress arrangement with Melo/Cloudflare first. Standard Workers do not provide a fixed egress IP by default.
