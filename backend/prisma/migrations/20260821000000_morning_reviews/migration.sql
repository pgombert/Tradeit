-- CreateTable
CREATE TABLE "morning_reviews" (
    "id" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "morning_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "morning_reviews_generated_at_idx" ON "morning_reviews"("generated_at" DESC);
