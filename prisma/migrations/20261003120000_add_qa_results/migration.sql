-- CreateTable
CREATE TABLE "qa_results" (
    "id" UUID NOT NULL,
    "brief_match_id" UUID NOT NULL,
    "brief_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "internal_conversation_ref" VARCHAR(200) NOT NULL,
    "packaged_record_ref" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL,
    "failures" JSONB NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "redaction_density" DOUBLE PRECISION NOT NULL,
    "dedup_status" VARCHAR(24) NOT NULL,
    "tier_counts" JSONB,
    "amount_cents" INTEGER,
    "pricing_schedule_version" VARCHAR(16),
    "qa_version" VARCHAR(16) NOT NULL,
    "dedup_version" VARCHAR(16) NOT NULL,
    "passed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "qa_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_results_brief_match_id_key" ON "qa_results"("brief_match_id");

-- CreateIndex
CREATE INDEX "qa_results_brief_id_status_idx" ON "qa_results"("brief_id", "status");

-- CreateIndex
CREATE INDEX "qa_results_user_id_idx" ON "qa_results"("user_id");

-- AddForeignKey
ALTER TABLE "qa_results" ADD CONSTRAINT "qa_results_brief_match_id_fkey" FOREIGN KEY ("brief_match_id") REFERENCES "brief_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

