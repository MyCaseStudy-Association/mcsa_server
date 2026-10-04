ALTER TABLE "qa_results" ADD COLUMN "packaged_chain_hash" TEXT;
ALTER TABLE "fund_allocations" ADD COLUMN "active_record_ref" TEXT;
UPDATE "fund_allocations" SET "active_record_ref" = "record_ref" WHERE status <> 'cancelled';
DROP INDEX "fund_allocations_record_ref_key";
CREATE UNIQUE INDEX "fund_allocations_active_record_ref_key" ON "fund_allocations"("active_record_ref");
