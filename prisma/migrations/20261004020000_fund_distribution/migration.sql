-- CreateTable
CREATE TABLE "contributor_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stripe_account_id" TEXT,
    "country" VARCHAR(2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributor_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "qa_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "record_ref" TEXT NOT NULL,
    "chain_hash" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'reserved',
    "transfer_id" TEXT,
    "destination" TEXT,
    "source_charge" TEXT,
    "approved_by" UUID,
    "started_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fund_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending',
    "stripe_refund_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fund_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_ledger_entries" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contributor_accounts_user_id_key" ON "contributor_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributor_accounts_stripe_account_id_key" ON "contributor_accounts"("stripe_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_allocations_qa_id_key" ON "fund_allocations"("qa_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_allocations_record_ref_key" ON "fund_allocations"("record_ref");

-- CreateIndex
CREATE UNIQUE INDEX "fund_allocations_transfer_id_key" ON "fund_allocations"("transfer_id");

-- CreateIndex
CREATE INDEX "fund_allocations_payment_id_status_idx" ON "fund_allocations"("payment_id", "status");

-- CreateIndex
CREATE INDEX "fund_allocations_user_id_idx" ON "fund_allocations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_refunds_payment_id_key" ON "fund_refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_refunds_stripe_refund_id_key" ON "fund_refunds"("stripe_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_ledger_entries_event_key_key" ON "fund_ledger_entries"("event_key");

-- CreateIndex
CREATE INDEX "fund_ledger_entries_payment_id_created_at_idx" ON "fund_ledger_entries"("payment_id", "created_at");

-- AddForeignKey
ALTER TABLE "contributor_accounts" ADD CONSTRAINT "contributor_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "brief_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocations_qa_id_fkey" FOREIGN KEY ("qa_id") REFERENCES "qa_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_refunds" ADD CONSTRAINT "fund_refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "brief_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger_entries" ADD CONSTRAINT "fund_ledger_entries_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "brief_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocation_positive" CHECK (amount_cents > 0);
ALTER TABLE "fund_refunds" ADD CONSTRAINT "fund_refund_positive" CHECK (amount_cents > 0);
ALTER TABLE "fund_ledger_entries" ADD CONSTRAINT "fund_ledger_nonnegative" CHECK (amount_cents >= 0);
ALTER TABLE "fund_allocations" ADD CONSTRAINT "fund_allocation_status" CHECK (status IN ('reserved','transferring','transferred','cancelled','review','reversing','reversed'));
ALTER TABLE "fund_refunds" ADD CONSTRAINT "fund_refund_status" CHECK (status IN ('pending','succeeded','review'));
