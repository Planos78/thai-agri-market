-- CreateEnum
CREATE TYPE "RescheduleStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('REDUCE', 'INCREASE');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncreasePayStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ProposedBy" AS ENUM ('ORCHARD', 'BUYER');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'RESCHEDULED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "refundIntentAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeliveryReschedule" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "proposedDate" TIMESTAMP(3) NOT NULL,
    "proposedBy" "ProposedBy" NOT NULL,
    "status" "RescheduleStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryReschedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAdjustment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "kind" "AdjustmentKind" NOT NULL,
    "deltaQty" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "proposedBy" "ProposedBy" NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncreasePayment" (
    "id" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "IncreasePayStatus" NOT NULL DEFAULT 'PENDING',
    "pspRef" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncreasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "trackingNo" TEXT,
    "carrier" TEXT,
    "proofUploadedBy" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryImage" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryReschedule_orderId_idx" ON "DeliveryReschedule"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryReschedule_status_idx" ON "DeliveryReschedule"("status");

-- CreateIndex
CREATE INDEX "OrderAdjustment_orderId_idx" ON "OrderAdjustment"("orderId");

-- CreateIndex
CREATE INDEX "OrderAdjustment_orderItemId_idx" ON "OrderAdjustment"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderAdjustment_status_idx" ON "OrderAdjustment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IncreasePayment_adjustmentId_key" ON "IncreasePayment"("adjustmentId");

-- CreateIndex
CREATE INDEX "IncreasePayment_orderId_idx" ON "IncreasePayment"("orderId");

-- CreateIndex
CREATE INDEX "IncreasePayment_status_idx" ON "IncreasePayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryImage_deliveryId_idx" ON "DeliveryImage"("deliveryId");

-- CreateIndex
CREATE INDEX "Review_orchardId_idx" ON "Review"("orchardId");

-- CreateIndex
CREATE INDEX "Review_orderId_idx" ON "Review"("orderId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryReschedule" ADD CONSTRAINT "DeliveryReschedule_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAdjustment" ADD CONSTRAINT "OrderAdjustment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncreasePayment" ADD CONSTRAINT "IncreasePayment_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "OrderAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncreasePayment" ADD CONSTRAINT "IncreasePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryImage" ADD CONSTRAINT "DeliveryImage_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
