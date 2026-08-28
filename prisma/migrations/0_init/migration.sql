-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120),
    "email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_fingerprints" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exact_hash" VARCHAR(64) NOT NULL,
    "sim_hash" VARCHAR(16) NOT NULL,
    "ruleset_version" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deid_attestations" (
    "id" UUID NOT NULL,
    "record_fingerprint" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "prev_hash" VARCHAR(64),
    "chain_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deid_attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_receipts" (
    "id" UUID NOT NULL,
    "receipt_ref" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" VARCHAR(128) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaged_records" (
    "id" UUID NOT NULL,
    "record_ref" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "internal_conversation_ref" VARCHAR(200) NOT NULL,
    "consent_receipt_ref" VARCHAR(64) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "captured_window" VARCHAR(16) NOT NULL,
    "domain_tags" JSONB NOT NULL,
    "prompts" JSONB NOT NULL,
    "turn_indexes" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'available',
    "prev_hash" VARCHAR(64),
    "chain_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaged_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "record_fingerprints_exact_hash_idx" ON "record_fingerprints"("exact_hash");

-- CreateIndex
CREATE UNIQUE INDEX "record_fingerprints_user_id_exact_hash_key" ON "record_fingerprints"("user_id", "exact_hash");

-- CreateIndex
CREATE INDEX "deid_attestations_record_fingerprint_idx" ON "deid_attestations"("record_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "consent_receipts_receipt_ref_key" ON "consent_receipts"("receipt_ref");

-- CreateIndex
CREATE INDEX "consent_receipts_user_id_idx" ON "consent_receipts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "packaged_records_record_ref_key" ON "packaged_records"("record_ref");

-- CreateIndex
CREATE INDEX "packaged_records_status_idx" ON "packaged_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "packaged_records_user_id_internal_conversation_ref_key" ON "packaged_records"("user_id", "internal_conversation_ref");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

