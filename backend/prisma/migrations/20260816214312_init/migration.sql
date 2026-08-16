-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('EQUITY', 'ETF', 'LEVERAGED_ETF', 'INVERSE_ETF');

-- CreateEnum
CREATE TYPE "EconRole" AS ENUM ('RATES', 'CREDIT', 'VOLATILITY', 'GROWTH', 'INFLATION', 'CONDITIONS');

-- CreateEnum
CREATE TYPE "ObservationSource" AS ENUM ('FRED', 'SCHWAB', 'SEC_EDGAR', 'FINNHUB', 'CBOE', 'FINRA', 'AAII', 'NAAIM', 'NEWSLETTER', 'DERIVED');

-- CreateEnum
CREATE TYPE "ObservationKind" AS ENUM ('ECON_RELEASE', 'PRICE_BAR', 'FILING', 'EARNINGS_EVENT', 'SENTIMENT_READING', 'SHORT_INTEREST', 'LETTER_ITEM');

-- CreateEnum
CREATE TYPE "CollectorStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "securities" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_class" "AssetClass" NOT NULL,
    "leverage_factor" INTEGER NOT NULL DEFAULT 1,
    "is_inverse" BOOLEAN NOT NULL DEFAULT false,
    "avg_dollar_volume" DECIMAL(20,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "securities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_bars" (
    "id" TEXT NOT NULL,
    "security_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(18,6) NOT NULL,
    "high" DECIMAL(18,6) NOT NULL,
    "low" DECIMAL(18,6) NOT NULL,
    "close" DECIMAL(18,6) NOT NULL,
    "volume" BIGINT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SCHWAB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_bars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "econ_series" (
    "series_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "role" "EconRole" NOT NULL,
    "units" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'FRED',
    "last_observed_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "econ_series_pkey" PRIMARY KEY ("series_id")
);

-- CreateTable
CREATE TABLE "econ_points" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "econ_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "source" "ObservationSource" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" "ObservationKind" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "url" TEXT,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collector_runs" (
    "id" TEXT NOT NULL,
    "collector" TEXT NOT NULL,
    "status" "CollectorStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "records_written" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "collector_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "securities_symbol_key" ON "securities"("symbol");

-- CreateIndex
CREATE INDEX "price_bars_date_idx" ON "price_bars"("date");

-- CreateIndex
CREATE UNIQUE INDEX "price_bars_security_id_date_key" ON "price_bars"("security_id", "date");

-- CreateIndex
CREATE INDEX "econ_points_series_id_date_idx" ON "econ_points"("series_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "econ_points_series_id_date_key" ON "econ_points"("series_id", "date");

-- CreateIndex
CREATE INDEX "observations_scope_observed_at_idx" ON "observations"("scope", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "observations_kind_observed_at_idx" ON "observations"("kind", "observed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "observations_source_source_ref_key" ON "observations"("source", "source_ref");

-- CreateIndex
CREATE INDEX "collector_runs_collector_started_at_idx" ON "collector_runs"("collector", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "price_bars" ADD CONSTRAINT "price_bars_security_id_fkey" FOREIGN KEY ("security_id") REFERENCES "securities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "econ_points" ADD CONSTRAINT "econ_points_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "econ_series"("series_id") ON DELETE CASCADE ON UPDATE CASCADE;
