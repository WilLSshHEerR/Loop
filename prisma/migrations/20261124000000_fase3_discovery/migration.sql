-- CreateEnum
CREATE TYPE "ContactChannelHint" AS ENUM ('EMAIL', 'WHATSAPP_MANUAL', 'PHONE_MANUAL');

-- AlterTable
ALTER TABLE "Prospect"
ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
ADD COLUMN "contactChannelHint" "ContactChannelHint",
ADD COLUMN "emailSource" TEXT;
