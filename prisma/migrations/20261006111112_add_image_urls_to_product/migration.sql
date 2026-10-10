-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill existing products
UPDATE "Product" SET "imageUrls" = ARRAY["imageUrl"] WHERE ("imageUrls" IS NULL OR "imageUrls" = ARRAY[]::TEXT[]) AND "imageUrl" IS NOT NULL AND "imageUrl" != '';
