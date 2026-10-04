# Stripe buyer funding

The flow is: buyer submits draft → admin sets total USD funding quote → buyer pays in Stripe Checkout → verified webhook records funding → admin activates → mobile matching. Checkout never activates a brief automatically.

## Configure and run

1. In the server's local `.env`, set `STRIPE_SECRET_KEY` to your Stripe **test-mode** secret key and `WEB_APP_URL=http://localhost:3000`. Keep keys out of the webapp/mobile environment and source control.
2. Install/sign in to the official [Stripe CLI](https://docs.stripe.com/stripe-cli).
3. Run:

   ```sh
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,charge.refunded,charge.dispute.created --forward-to localhost:6001/payments/stripe/webhook
   ```

4. Put the listener's webhook signing secret in server `.env` as `STRIPE_WEBHOOK_SECRET`. Restart the NestJS server. Keep the listener running.
5. Sign in as admin, open Brief moderation, enter the **total USD quote**, and save it. Only unexpired, unpaid briefs without a checkout attempt can be quoted.
6. Sign in as the owning buyer. The brief displays the quoted amount and a **Pay with Stripe** button. Test checkout with Stripe's [test payment methods](https://docs.stripe.com/testing); do not use real card details in test mode.
7. Returning from checkout shows a pending confirmation message. Verified payment events update the brief to Funding confirmed. The page refreshes for 30 seconds and also offers manual refresh.
8. Sign in as admin and activate the funded brief. Confirm it appears in mobile `/briefs/push`. Payment alone must not put it there.

## Production configuration

Use live Stripe credentials on the production server, set `WEB_APP_URL` to the HTTPS webapp origin, and register the public HTTPS server endpoint `/payments/stripe/webhook` in Stripe Workbench with the five events above. Use that endpoint's signing secret, not the local CLI signing secret. Follow the account-specific Stripe onboarding requirements before accepting live payments. Run a complete test-mode checkout first; the repository checks mock Stripe API responses and do not prove that your Stripe account/webhook configuration works.

Payment methods are controlled in the Stripe Dashboard (dynamic payment methods). Delayed methods are funded only once Stripe reports payment as paid. Failed delayed payments allow retry. Card declines can be retried within Checkout; cancelled checkouts can be resumed. Expired sessions receive a new attempt with a new idempotency key.

## Guarantees and boundaries

- Only the buyer who owns the brief can open its checkout. Only admins quote and activate. Clients never submit a charge amount to Checkout.
- Quotes are frozen once a payment attempt exists. One ledger row per brief plus stable per-attempt Stripe idempotency keys avoids duplicate checkout creation. Transaction conflicts return an error; retry safely.
- Raw-body signature verification, Stripe object retrieval, identity/amount/currency checks, and atomic event receipts protect funding updates. The success URL is never proof of payment.
- Duplicate success events do not double-fund; late success cannot override refund/dispute status. Partial or full refund/dispute events revoke funding and pause the brief. These require manual review; this implementation does not automatically restore disputed funding.
- Refunds are initiated in Stripe Dashboard; the verified webhook updates the app. An in-app refund button, contributor payouts/Stripe Connect, delivery settlement, tax automation, and true escrow services are outside this brief-funding integration.
- The existing `escrowCommitted` column is retained as the internal matching eligibility flag. The UI calls it funding: a successful Checkout charge is captured payment, not a Stripe-provided escrow arrangement.
- Closing/expiry of a brief does not automatically refund a captured payment. Admins must review those payments in Stripe. Historical sandbox-funded seed briefs are preserved.
- No card details, webhook payloads, chat text, or secrets are persisted by this feature. Stripe receives a generic funding line item, brief reference, and payment identifier, not the brief specification or contributor data.

## API

- `POST /payments/briefs/:briefRef/quote` (admin): `{ "amountCents": 2500 }` = USD 25.00; range 50–99,999,999 cents.
- `POST /payments/briefs/:briefRef/checkout` (owning buyer): returns `{ "url": "https://checkout.stripe.com/..." }`.
- `POST /payments/stripe/webhook` (Stripe signature): no JWT; raw body required.
- Existing `GET /buyer/briefs` additionally returns funding quote and payment status/amount/currency. Contributor API payloads are unchanged.

Database: `briefs.funding_amount_cents`, `brief_payments`, and `stripe_events`. Migration: `20261004010000_stripe_funding`.

Validation: `npm run lint`, `npm test -- --runInBand`, `npm run build`. Stripe-related tests are `src/payments/payments.service.spec.ts`.

Implementation references: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhook signatures and retries](https://docs.stripe.com/webhooks), [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
