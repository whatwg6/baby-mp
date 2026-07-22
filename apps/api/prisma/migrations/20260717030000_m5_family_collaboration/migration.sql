CREATE TYPE "invite_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE "family_invites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "baby_id" UUID NOT NULL,
  "role" "member_role" NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "status" "invite_status" NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by" UUID NOT NULL,
  "accepted_by" UUID,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "family_invites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "family_invites_role_check" CHECK ("role" IN ('editor', 'viewer')),
  CONSTRAINT "family_invites_acceptance_check" CHECK (
    ("status" = 'accepted' AND "accepted_by" IS NOT NULL AND "accepted_at" IS NOT NULL)
    OR ("status" <> 'accepted' AND "accepted_by" IS NULL AND "accepted_at" IS NULL)
  ),
  CONSTRAINT "family_invites_revocation_check" CHECK (
    ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    OR ("status" <> 'revoked' AND "revoked_at" IS NULL)
  )
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "baby_id" UUID,
  "action" VARCHAR(80) NOT NULL,
  "resource_type" VARCHAR(50) NOT NULL,
  "resource_id" UUID,
  "request_id" VARCHAR(64),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "family_invites_token_hash_key" ON "family_invites"("token_hash");
CREATE INDEX "family_invites_baby_id_status_created_at_idx" ON "family_invites"("baby_id", "status", "created_at" DESC);
CREATE INDEX "family_invites_expires_at_status_idx" ON "family_invites"("expires_at", "status");
CREATE INDEX "audit_logs_baby_id_created_at_idx" ON "audit_logs"("baby_id", "created_at" DESC);
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_baby_id_fkey" FOREIGN KEY ("baby_id") REFERENCES "babies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_baby_id_fkey" FOREIGN KEY ("baby_id") REFERENCES "babies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
