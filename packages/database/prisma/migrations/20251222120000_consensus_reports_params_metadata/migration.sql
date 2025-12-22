-- Step 22: traceability + failure details for consensus reports
ALTER TABLE "consensus_reports"
  ADD COLUMN "params" JSONB,
  ADD COLUMN "metadata" JSONB;

