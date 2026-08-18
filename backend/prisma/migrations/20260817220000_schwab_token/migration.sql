-- The single user's Schwab brokerage connection. One row, keyed on a constant
-- id. Read-only Trader API access; the refresh token lives ~7 days and is
-- re-minted through the dashboard connect flow.

-- CreateTable
CREATE TABLE "schwab_tokens" (
    "id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "account_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schwab_tokens_pkey" PRIMARY KEY ("id")
);
