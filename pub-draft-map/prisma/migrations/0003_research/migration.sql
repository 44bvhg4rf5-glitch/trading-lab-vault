-- AlterTable
ALTER TABLE "Pub" ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "researchedAt" TIMESTAMP(3);

