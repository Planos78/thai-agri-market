-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('PENDING', 'RELEASED', 'HOLD', 'DOWNGRADED');

-- AlterTable
ALTER TABLE "Lot" ADD COLUMN     "qcStatus" "QcStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "QcAudit" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "fromStatus" "QcStatus" NOT NULL,
    "toStatus" "QcStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "adminUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentLog" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOrchardScope" (
    "adminUserId" TEXT NOT NULL,
    "orchardId" TEXT NOT NULL,

    CONSTRAINT "UserOrchardScope_pkey" PRIMARY KEY ("adminUserId","orchardId")
);

-- CreateIndex
CREATE INDEX "QcAudit_lotId_idx" ON "QcAudit"("lotId");

-- CreateIndex
CREATE INDEX "ConsentLog_lineUserId_idx" ON "ConsentLog"("lineUserId");

-- AddForeignKey
ALTER TABLE "QcAudit" ADD CONSTRAINT "QcAudit_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcAudit" ADD CONSTRAINT "QcAudit_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrchardScope" ADD CONSTRAINT "UserOrchardScope_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrchardScope" ADD CONSTRAINT "UserOrchardScope_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
