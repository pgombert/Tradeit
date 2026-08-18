-- CreateTable
CREATE TABLE "weekly_briefs" (
    "id" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regime" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "weekly_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weekly_briefs_generated_at_idx" ON "weekly_briefs"("generated_at" DESC);
