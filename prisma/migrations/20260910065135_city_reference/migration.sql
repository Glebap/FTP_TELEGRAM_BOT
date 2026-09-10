-- AlterTable
ALTER TABLE "User" ADD COLUMN "cityGeonameId" INTEGER;

-- CreateIndex
CREATE INDEX "User_cityGeonameId_idx" ON "User"("cityGeonameId");
