-- AlterTable
ALTER TABLE "Pub" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "imageCredit" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "operator" TEXT;

-- AlterTable
ALTER TABLE "TapListing" ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "inferredFrom" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'user';

