ALTER TABLE "briefs" ADD COLUMN "funding_amount_cents" INTEGER;
CREATE TABLE "brief_payments" (
 "id" UUID NOT NULL, "brief_id" UUID NOT NULL, "amount_cents" INTEGER NOT NULL,
 "currency" VARCHAR(3) NOT NULL DEFAULT 'usd', "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
 "attempt" INTEGER NOT NULL DEFAULT 1, "session_id" TEXT, "payment_intent_id" TEXT,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "brief_payments_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "brief_payments_amount_check" CHECK ("amount_cents" >= 50 AND "amount_cents" <= 99999999),
 CONSTRAINT "brief_payments_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "brief_payments_brief_id_key" ON "brief_payments"("brief_id");
CREATE UNIQUE INDEX "brief_payments_session_id_key" ON "brief_payments"("session_id");
CREATE UNIQUE INDEX "brief_payments_payment_intent_id_key" ON "brief_payments"("payment_intent_id");
CREATE TABLE "stripe_events" ("id" TEXT NOT NULL, "type" VARCHAR(120) NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id"));
