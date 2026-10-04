# Fund distribution

Implemented in `src/settlement/`. This is platform funding and Stripe Connect settlement, **not a legal escrow service**.

## Activation

1. Complete Stripe Connect platform setup and confirm the platform/contributor countries support separate charges and transfers. Do not infer country support from a user's location.
2. Configure `STRIPE_CONNECT_COUNTRIES` as an explicit comma-separated ISO country allowlist approved for your Stripe account.
3. Test Connect onboarding, a small funding charge, QA reservation, transfer, expiry refund and dispute recovery in a Stripe sandbox.
4. Set `SETTLEMENT_ENABLED=true` and restart the server only when ready. The default is disabled. Keep the server running for the once-per-minute settlement worker.
5. Retain the existing signature-verified Checkout/refund/dispute webhook endpoint and subscriptions. Connect account readiness is retrieved directly from Stripe. Contributors can inspect bank payouts through their Stripe dashboard link.

The implementation creates Accounts v2 recipients with an Express dashboard, the authenticated contributor’s contact email, and the stripe_balance.stripe_transfers capability. Fees and loss responsibility remain application. Onboarding links use v2; payout readiness and Express login links use the supported v1 interoperability APIs. No identity documents or bank details are stored locally. Only country, user reference and connected account ID are stored.

## Policy and workflow

- USD only. The existing server QA valuation is the contributor's amount. No extra commission is applied. Stripe processing/Connect costs are borne by the platform and are not silently subtracted from contributor earnings.
- Admin selects a quality-approved contribution and reserves its precise valuation. Serializable database transactions serialize funding claims; available funds, total collection target and per-contributor limits are enforced.
- A QA result must identify the exact packaged chain hash being purchased. Existing QA results without a snapshot must be re-evaluated through the normal pipeline before selection.
- Contributor completes Stripe-hosted onboarding from `/dashboard/funds`.
- Admin explicitly approves a reservation. The server rechecks funding with Stripe, current QA, consent, immutable record snapshot and connected account capabilities. This commits the sale and submits a transfer with a stable idempotency key and the original charge as `source_transaction`.
- Transfers are not bank payouts. Stripe performs connected-account bank payouts according to its account settings; the contributor's dashboard opens Stripe's payout history.
- At expiry, the worker closes matching, cancels unreleased reservations and requests a refund of unused funds. Transfers with uncertain outcomes hold back refunds. Refund confirmation is polled from Stripe; failed/cancelled refunds remain held for review.
- A cancelled reservation stays in the audit history. Its record can be selected for another eligible brief; it cannot be sold twice.
- External refunds/disputes freeze funding, cancel open reservations and attempt full reversal of already transferred allocations. A recovery failure stays in `reversing` and must be investigated in Stripe. Reversal is not guaranteed after the recipient has spent/withdrawn funds; the platform is responsible for shortfalls. Own unused-fund refunds do not reverse contributor transfers.
- Worker processes up to 50 funding records per minute, using a rotating cursor. Provider failures are retried next cycle; it does not invent successful outcomes. It recovers saved transfer/refund references by provider metadata after a crash. Missing-operation retries older than 23 hours fail closed to avoid Stripe idempotency-key expiry.
- Manual reconciliation is required for unresolved operations older than the safe retry window, partially reversed transfers and failed refunds. Do not delete operation rows or change their keys to retry.

## API

All endpoints require JWT and recheck current database role. No contributor identity comes from request bodies.

- `GET /settlement/dashboard`: role-scoped financial metadata. Admin all recent payments; buyer owned payments only; contributor own allocations and earnings totals, no buyer identity or brief specification. Payment list is capped at 100; ledger preview at 20 per payment; contributor totals aggregate all allocations.
- `POST /settlement/connect`: contributor, `{country: "US"}` from configured allowed countries.
- `POST /settlement/payout-dashboard`: contributor-only short-lived Stripe dashboard link.
- `POST /settlement/reserve/:qaId`: admin, reserve QA valuation.
- `POST /settlement/release/:id`: admin, approve and transfer.
- `POST /settlement/cancel/:id`: admin, cancel unreleased reservation.

Web integration is `webapp/app/dashboard/funds/`. Existing mobile request/response shapes are unchanged; contributors currently manage payout setup and earnings through the web account. The mobile import/matching flow produces the QA records used here.

## Verification

Unit tests cover authorization, insufficient funding, contributor limits, current QA/consent, payment disputes, duplicate operations, and refund balance conservation. A database smoke test uses disposable rows and mocked Stripe I/O to test competing reservations, duplicate transfers/refunds, role-scoped views, and a 60-cent transfer plus 40-cent unused refund. No real-money operation is run by these tests.

References:
- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/connect/migrate-to-controller-properties
- https://docs.stripe.com/connect/express-dashboard

## Accounts v2 migration

New accounts use a stable `connect-v2:<contributor-reference>` idempotency key. Existing stored Stripe account IDs are reused. The previous v1 policy-rejection retry is removed. The reported legacy requests were definitively rejected; any other legacy creation with an uncertain outcome must be reconciled in Stripe before retrying with v2. Never delete account references to retry onboarding. The 23-hour recovery guard remains in place.

References: https://docs.stripe.com/connect/accounts-v2
