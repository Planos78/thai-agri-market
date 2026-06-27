-- CreateEnum
CREATE TYPE "PackingStatus" AS ENUM ('OPEN', 'RECONCILED', 'VARIANCE', 'SIGNED_OFF');

-- CreateEnum
CREATE TYPE "ClaimCategory" AS ENUM ('DAMAGED', 'QUALITY', 'MISSING', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'TRIAGING', 'RESOLVED', 'REJECTED', 'ESCALATED');

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "claimId" TEXT;

-- CreateTable
CREATE TABLE "PackingManifest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "PackingStatus" NOT NULL DEFAULT 'OPEN',
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "packedCount" INTEGER NOT NULL DEFAULT 0,
    "hasVariance" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "packedBy" TEXT,
    "packedAt" TIMESTAMP(3),
    "signedOffBy" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingItem" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "packedQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManifestImage" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "claimNo" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT,
    "lineUserId" TEXT,
    "category" "ClaimCategory" NOT NULL DEFAULT 'OTHER',
    "severity" "ClaimSeverity" NOT NULL DEFAULT 'LOW',
    "description" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "aiFlag" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimImage" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackingManifest_orderId_key" ON "PackingManifest"("orderId");

-- CreateIndex
CREATE INDEX "PackingManifest_status_idx" ON "PackingManifest"("status");

-- CreateIndex
CREATE INDEX "PackingItem_manifestId_idx" ON "PackingItem"("manifestId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingItem_manifestId_orderItemId_key" ON "PackingItem"("manifestId", "orderItemId");

-- CreateIndex
CREATE INDEX "ManifestImage_manifestId_idx" ON "ManifestImage"("manifestId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_claimNo_key" ON "Claim"("claimNo");

-- CreateIndex
CREATE INDEX "Claim_orderId_idx" ON "Claim"("orderId");

-- CreateIndex
CREATE INDEX "Claim_status_idx" ON "Claim"("status");

-- CreateIndex
CREATE INDEX "ClaimImage_claimId_idx" ON "ClaimImage"("claimId");

-- CreateIndex
CREATE INDEX "ClaimEvent_claimId_idx" ON "ClaimEvent"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_claimId_key" ON "Refund"("claimId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingManifest" ADD CONSTRAINT "PackingManifest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "PackingManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingItem" ADD CONSTRAINT "PackingItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManifestImage" ADD CONSTRAINT "ManifestImage_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "PackingManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimImage" ADD CONSTRAINT "ClaimImage_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

