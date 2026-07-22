CREATE TYPE "media_purpose" AS ENUM ('record_image', 'export_archive');
CREATE TYPE "export_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'expired');

ALTER TABLE "media"
  ADD COLUMN "purpose" "media_purpose" NOT NULL DEFAULT 'record_image';

-- Export archives are linked to their processing job before multipart upload so
-- cleanup cannot race the worker. Their final size is unknown at that point.
ALTER TABLE "media" DROP CONSTRAINT "media_size_positive";
ALTER TABLE "media" ADD CONSTRAINT "media_size_positive" CHECK (
  "size_bytes" > 0
  OR (
    "purpose" = 'export_archive'
    AND "status" = 'pending'
    AND "size_bytes" = 0
  )
);

CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "baby_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "status" "export_status" NOT NULL DEFAULT 'pending',
  "scope" JSONB NOT NULL,
  "result_media_id" UUID,
  "error_code" VARCHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "worker_lease_id" UUID,
  "lease_expires_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_attempt_count_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "export_jobs_lease_check" CHECK (
    ("status" = 'processing' AND "worker_lease_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'processing' AND "worker_lease_id" IS NULL AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "export_jobs_completion_check" CHECK (
    ("status" IN ('completed', 'expired') AND "result_media_id" IS NOT NULL AND "completed_at" IS NOT NULL AND "expires_at" IS NOT NULL)
    OR ("status" NOT IN ('completed', 'expired'))
  )
);

CREATE UNIQUE INDEX "export_jobs_result_media_id_key" ON "export_jobs"("result_media_id");
CREATE INDEX "export_jobs_baby_id_created_at_id_idx" ON "export_jobs"("baby_id", "created_at" DESC, "id" DESC);
CREATE INDEX "export_jobs_status_next_attempt_at_idx" ON "export_jobs"("status", "next_attempt_at");
CREATE INDEX "export_jobs_requested_by_created_at_idx" ON "export_jobs"("requested_by", "created_at" DESC);
CREATE UNIQUE INDEX "export_jobs_one_active_per_requester_baby_idx"
  ON "export_jobs"("requested_by", "baby_id")
  WHERE "status" IN ('pending', 'processing');

ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_baby_id_fkey"
  FOREIGN KEY ("baby_id") REFERENCES "babies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_result_media_id_fkey"
  FOREIGN KEY ("result_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
