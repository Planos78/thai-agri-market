-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('LIFF', 'SHOP');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "RefundPayout" AS ENUM ('CUSTOMER', 'PLANT');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "refundedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'LIFF';

-- CreateTable
CREATE TABLE "Bank" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" TEXT NOT NULL,
    "orchardId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "accNo" TEXT NOT NULL,
    "accName" TEXT NOT NULL,
    "payoutKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL,
    "takeRate" DECIMAL(65,30) NOT NULL DEFAULT 0.10,
    "vatRate" DECIMAL(65,30) NOT NULL DEFAULT 0.07,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "pspBatchRef" TEXT,
    "createdBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatchOrder" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "payoutAccountId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "PayoutBatchOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutResponse" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "respCode" TEXT NOT NULL,
    "respDesc" TEXT,
    "pspBatchRef" TEXT,
    "signature" TEXT,
    "rawPayload" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutErrorLog" (
    "id" TEXT NOT NULL,
    "payoutBatchId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT NOT NULL,
    "rawPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "refundNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderAdjustmentId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "kind" "RefundKind" NOT NULL,
    "payoutType" "RefundPayout" NOT NULL DEFAULT 'CUSTOMER',
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "pspRef" TEXT,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Bank_code_key" ON "Bank"("code");

-- CreateIndex
CREATE INDEX "PayoutAccount_orchardId_idx" ON "PayoutAccount"("orchardId");

-- CreateIndex
CREATE INDEX "PlatformConfig_isActive_idx" ON "PlatformConfig"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_batchNo_key" ON "PayoutBatch"("batchNo");

-- CreateIndex
CREATE INDEX "PayoutBatch_status_idx" ON "PayoutBatch"("status");

-- CreateIndex
CREATE INDEX "PayoutBatchOrder_orderId_idx" ON "PayoutBatchOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatchOrder_payoutBatchId_orderId_key" ON "PayoutBatchOrder"("payoutBatchId", "orderId");

-- CreateIndex
CREATE INDEX "PayoutResponse_payoutBatchId_idx" ON "PayoutResponse"("payoutBatchId");

-- CreateIndex
CREATE INDEX "PayoutErrorLog_payoutBatchId_idx" ON "PayoutErrorLog"("payoutBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_refundNo_key" ON "Refund"("refundNo");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_orderAdjustmentId_key" ON "Refund"("orderAdjustmentId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "Bank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatch" ADD CONSTRAINT "PayoutBatch_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchOrder" ADD CONSTRAINT "PayoutBatchOrder_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchOrder" ADD CONSTRAINT "PayoutBatchOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutBatchOrder" ADD CONSTRAINT "PayoutBatchOrder_payoutAccountId_fkey" FOREIGN KEY ("payoutAccountId") REFERENCES "PayoutAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutResponse" ADD CONSTRAINT "PayoutResponse_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutErrorLog" ADD CONSTRAINT "PayoutErrorLog_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderAdjustmentId_fkey" FOREIGN KEY ("orderAdjustmentId") REFERENCES "OrderAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
