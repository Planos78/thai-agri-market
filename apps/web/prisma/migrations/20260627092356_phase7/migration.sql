-- CreateTable
CREATE TABLE "CronLog" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "note" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CronLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationSnapshot" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "paymentsIn" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "payoutsOut" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "refundsOut" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "platformFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "heldEscrow" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "variance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronLog_task_runAt_idx" ON "CronLog"("task", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "CronLog_task_period_key" ON "CronLog"("task", "period");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationSnapshot_period_key" ON "ReconciliationSnapshot"("period");

-- CreateIndex
CREATE INDEX "ReconciliationSnapshot_createdAt_idx" ON "ReconciliationSnapshot"("createdAt");
