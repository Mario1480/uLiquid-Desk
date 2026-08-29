ALTER TABLE "onchain_indexed_events"
ADD COLUMN "block_timestamp" TIMESTAMP(3);

CREATE INDEX "onchain_indexed_events_chain_timestamp_idx"
ON "onchain_indexed_events"("chain_id", "block_timestamp" DESC);
