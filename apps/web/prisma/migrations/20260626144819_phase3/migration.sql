-- CreateEnum
CREATE TYPE "PushStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "OrchardRegisterCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orchardId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchardRegisterCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchardLineBinding" (
    "id" TEXT NOT NULL,
    "orchardId" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchardLineBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiffRequestLog" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiffRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineBotLog" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "replyToken" TEXT,
    "text" TEXT,
    "rawEvent" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineBotLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushJob" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "PushStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrchardRegisterCode_code_key" ON "OrchardRegisterCode"("code");

-- CreateIndex
CREATE INDEX "OrchardRegisterCode_orchardId_idx" ON "OrchardRegisterCode"("orchardId");

-- CreateIndex
CREATE INDEX "OrchardLineBinding_lineUserId_idx" ON "OrchardLineBinding"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OrchardLineBinding_orchardId_lineUserId_key" ON "OrchardLineBinding"("orchardId", "lineUserId");

-- CreateIndex
CREATE INDEX "LiffRequestLog_lineUserId_idx" ON "LiffRequestLog"("lineUserId");

-- CreateIndex
CREATE INDEX "LiffRequestLog_createdAt_idx" ON "LiffRequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "LineBotLog_lineUserId_idx" ON "LineBotLog"("lineUserId");

-- CreateIndex
CREATE INDEX "PushJob_status_nextAttemptAt_idx" ON "PushJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PushJob_lineUserId_idx" ON "PushJob"("lineUserId");

-- AddForeignKey
ALTER TABLE "OrchardRegisterCode" ADD CONSTRAINT "OrchardRegisterCode_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrchardLineBinding" ADD CONSTRAINT "OrchardLineBinding_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
