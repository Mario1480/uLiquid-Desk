CREATE TABLE "mobile_watchlist_items" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "market_type" TEXT NOT NULL DEFAULT 'perp',
  "exchange" TEXT NOT NULL DEFAULT 'any',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mobile_watchlist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mobile_watchlist_items_user_symbol_market_exchange_key"
  ON "mobile_watchlist_items"("user_id", "symbol", "market_type", "exchange");
CREATE INDEX "mobile_watchlist_items_user_sort_idx"
  ON "mobile_watchlist_items"("user_id", "sort_order");

ALTER TABLE "mobile_watchlist_items"
  ADD CONSTRAINT "mobile_watchlist_items_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
