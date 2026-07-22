CREATE TYPE "data_rights_request_type" AS ENUM (
  'account_deletion',
  'data_access',
  'correction'
);

CREATE TYPE "data_rights_request_status" AS ENUM (
  'pending',
  'processing',
  'completed',
  'rejected',
  'cancelled'
);

CREATE TABLE "data_rights_requests" (
  "id" UUID NOT NULL,
  "requester_user_id" UUID NOT NULL,
  "baby_id" UUID,
  "type" "data_rights_request_type" NOT NULL,
  "status" "data_rights_request_status" NOT NULL DEFAULT 'pending',
  "active_request_key" VARCHAR(160),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "resolved_at" TIMESTAMPTZ(3),

  CONSTRAINT "data_rights_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_rights_requests_requester_user_id_fkey"
    FOREIGN KEY ("requester_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "data_rights_requests_baby_id_fkey"
    FOREIGN KEY ("baby_id") REFERENCES "babies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "data_rights_requests_active_request_key_key"
  ON "data_rights_requests"("active_request_key");
CREATE INDEX "data_rights_requests_requester_user_id_created_at_idx"
  ON "data_rights_requests"("requester_user_id", "created_at" DESC);
CREATE INDEX "data_rights_requests_status_created_at_idx"
  ON "data_rights_requests"("status", "created_at");
