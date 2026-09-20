-- CreateTable
CREATE TABLE "buyers" (
    "id" UUID NOT NULL,
    "buyer_ref" VARCHAR(64) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "category_id" VARCHAR(64) NOT NULL,
    "category_taxonomy_version" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" UUID NOT NULL,
    "brief_ref" VARCHAR(64) NOT NULL,
    "buyer_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "spec" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "volume" JSONB NOT NULL,
    "pricing_schedule_version" VARCHAR(16) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "escrow_committed" BOOLEAN NOT NULL DEFAULT false,
    "escrow_provider_ref" VARCHAR(128),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_matches" (
    "id" UUID NOT NULL,
    "brief_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "internal_conversation_ref" VARCHAR(200) NOT NULL,
    "prompt_count" INTEGER NOT NULL,
    "fingerprints" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brief_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyers_buyer_ref_key" ON "buyers"("buyer_ref");

-- CreateIndex
CREATE UNIQUE INDEX "briefs_brief_ref_key" ON "briefs"("brief_ref");

-- CreateIndex
CREATE INDEX "briefs_status_idx" ON "briefs"("status");

-- CreateIndex
CREATE INDEX "brief_matches_user_id_idx" ON "brief_matches"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brief_matches_brief_id_user_id_internal_conversation_ref_key" ON "brief_matches"("brief_id", "user_id", "internal_conversation_ref");

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_matches" ADD CONSTRAINT "brief_matches_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
