CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "WebsiteStatus" AS ENUM ('NONE', 'SLOW', 'NOT_MOBILE_FRIENDLY', 'OUTDATED', 'OK', 'UNKNOWN');
CREATE TYPE "ProspectStatus" AS ENUM ('NEW', 'QUALIFIED', 'DRAFTED', 'PENDING_APPROVAL', 'CONTACTED', 'REPLIED', 'CALL_SCHEDULED', 'PROPOSAL_SENT', 'WON', 'LOST', 'DO_NOT_CONTACT');
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM');
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'FAILED');

CREATE TABLE "Prospect" (
    "id" UUID NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "websiteUrl" TEXT,
    "googleMapsUrl" TEXT,
    "googlePlaceId" TEXT,
    "rating" DOUBLE PRECISION,
    "reviewsCount" INTEGER,
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "ProspectStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "prospectId" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'DRAFT',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Suppression" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Suppression_contact_check" CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL)
);

CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Prospect_googlePlaceId_key" ON "Prospect"("googlePlaceId");
CREATE INDEX "Prospect_status_createdAt_idx" ON "Prospect"("status", "createdAt");
CREATE INDEX "Conversation_prospectId_idx" ON "Conversation"("prospectId");
CREATE INDEX "Message_status_createdAt_idx" ON "Message"("status", "createdAt");
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX "Suppression_email_idx" ON "Suppression"("email");
CREATE INDEX "Suppression_phone_idx" ON "Suppression"("phone");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;