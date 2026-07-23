CREATE TYPE "platform_type" AS ENUM ('wechat_mini', 'alipay_mini', 'douyin_mini', 'h5');
CREATE TYPE "user_status" AS ENUM ('active', 'disabled', 'deleted');
CREATE TYPE "baby_gender" AS ENUM ('male', 'female', 'unspecified');
CREATE TYPE "member_role" AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE "member_status" AS ENUM ('active', 'removed');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "display_name" VARCHAR(80), "avatar_media_id" UUID,
  "status" "user_status" NOT NULL DEFAULT 'active', "last_login_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3), CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "platform_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "platform" "platform_type" NOT NULL,
  "app_id" VARCHAR(128) NOT NULL, "subject" VARCHAR(255) NOT NULL, "union_subject" VARCHAR(255),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_identities_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "refresh_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL, "family_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL, "platform" "platform_type" NOT NULL, "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3), "revoke_reason" VARCHAR(40), "replaced_by_session_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "babies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(40) NOT NULL, "gender" "baby_gender" NOT NULL,
  "birth_date" DATE NOT NULL, "birth_time" TIME(0), "birth_height_cm" DECIMAL(5,2), "birth_weight_kg" DECIMAL(6,3),
  "avatar_media_id" UUID, "created_by" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3), CONSTRAINT "babies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "babies_birth_height_check" CHECK ("birth_height_cm" IS NULL OR ("birth_height_cm" >= 20 AND "birth_height_cm" <= 250)),
  CONSTRAINT "babies_birth_weight_check" CHECK ("birth_weight_kg" IS NULL OR ("birth_weight_kg" >= 0.2 AND "birth_weight_kg" <= 300))
);
CREATE TABLE "baby_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "baby_id" UUID NOT NULL, "user_id" UUID NOT NULL,
  "role" "member_role" NOT NULL, "status" "member_status" NOT NULL DEFAULT 'active', "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invited_by" UUID, "removed_at" TIMESTAMPTZ(3), "removed_by" UUID, "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "baby_members_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "idempotency_keys" (
  "user_id" UUID NOT NULL, "key" VARCHAR(128) NOT NULL, "operation" VARCHAR(80) NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "response_code" INTEGER, "response_body" JSONB, "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id", "operation", "key")
);
CREATE UNIQUE INDEX "platform_identities_platform_app_id_subject_key" ON "platform_identities"("platform", "app_id", "subject");
CREATE INDEX "platform_identities_user_id_idx" ON "platform_identities"("user_id");
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");
CREATE UNIQUE INDEX "refresh_sessions_replaced_by_session_id_key" ON "refresh_sessions"("replaced_by_session_id");
CREATE INDEX "refresh_sessions_user_id_revoked_at_idx" ON "refresh_sessions"("user_id", "revoked_at");
CREATE INDEX "refresh_sessions_family_id_idx" ON "refresh_sessions"("family_id");
CREATE INDEX "babies_created_by_idx" ON "babies"("created_by");
CREATE UNIQUE INDEX "baby_members_baby_id_user_id_key" ON "baby_members"("baby_id", "user_id");
CREATE INDEX "baby_members_user_id_status_idx" ON "baby_members"("user_id", "status");
CREATE INDEX "baby_members_baby_id_status_idx" ON "baby_members"("baby_id", "status");
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");
ALTER TABLE "platform_identities" ADD CONSTRAINT "platform_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_replaced_by_session_id_fkey" FOREIGN KEY ("replaced_by_session_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "babies" ADD CONSTRAINT "babies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "baby_members" ADD CONSTRAINT "baby_members_baby_id_fkey" FOREIGN KEY ("baby_id") REFERENCES "babies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "baby_members" ADD CONSTRAINT "baby_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "baby_members" ADD CONSTRAINT "baby_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "baby_members" ADD CONSTRAINT "baby_members_removed_by_fkey" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
