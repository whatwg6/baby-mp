CREATE TYPE "record_type" AS ENUM ('note', 'measurement', 'milestone');
CREATE TYPE "media_status" AS ENUM ('pending', 'uploaded', 'ready', 'failed', 'deleted');

CREATE TABLE "media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "baby_id" UUID NOT NULL,
  "storage_provider" VARCHAR(32) NOT NULL DEFAULT 's3',
  "bucket" VARCHAR(128) NOT NULL,
  "object_key" VARCHAR(512) NOT NULL,
  "upload_object_key" VARCHAR(512),
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "sha256" CHAR(64),
  "status" "media_status" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ready_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "purged_at" TIMESTAMPTZ(3),
  CONSTRAINT "media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_size_positive" CHECK ("size_bytes" > 0),
  CONSTRAINT "media_dimensions_positive" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0))
);

CREATE TABLE "records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "baby_id" UUID NOT NULL,
  "type" "record_type" NOT NULL,
  "title" VARCHAR(120),
  "content" TEXT,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by" UUID NOT NULL,
  "updated_by" UUID NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  "deleted_by" UUID,
  CONSTRAINT "records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "records_version_positive" CHECK ("version" > 0),
  CONSTRAINT "records_type_fields" CHECK (
    ("type" <> 'milestone' OR ("title" IS NOT NULL AND length(btrim("title")) > 0))
  )
);

CREATE TABLE "measurement_records" (
  "record_id" UUID NOT NULL,
  "height_cm" DECIMAL(5,2),
  "weight_kg" DECIMAL(6,3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "measurement_records_pkey" PRIMARY KEY ("record_id"),
  CONSTRAINT "measurement_at_least_one" CHECK ("height_cm" IS NOT NULL OR "weight_kg" IS NOT NULL),
  CONSTRAINT "measurement_height_range" CHECK ("height_cm" IS NULL OR ("height_cm" >= 20 AND "height_cm" <= 250)),
  CONSTRAINT "measurement_weight_range" CHECK ("weight_kg" IS NULL OR ("weight_kg" >= 0.2 AND "weight_kg" <= 300))
);

CREATE TABLE "record_media" (
  "record_id" UUID NOT NULL,
  "media_id" UUID NOT NULL,
  "sort_order" SMALLINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "record_media_pkey" PRIMARY KEY ("record_id", "media_id"),
  CONSTRAINT "record_media_sort_order_nonnegative" CHECK ("sort_order" >= 0)
);

CREATE UNIQUE INDEX "media_object_key_key" ON "media"("object_key");
CREATE UNIQUE INDEX "media_upload_object_key_key" ON "media"("upload_object_key");
CREATE INDEX "media_baby_id_status_idx" ON "media"("baby_id", "status");
CREATE INDEX "media_owner_user_id_status_created_at_idx" ON "media"("owner_user_id", "status", "created_at");
CREATE INDEX "records_baby_id_occurred_at_id_idx" ON "records"("baby_id", "occurred_at" DESC, "id" DESC);
CREATE INDEX "records_baby_id_type_occurred_at_id_idx" ON "records"("baby_id", "type", "occurred_at" DESC, "id" DESC);
CREATE INDEX "records_created_by_created_at_idx" ON "records"("created_by", "created_at" DESC);
CREATE UNIQUE INDEX "record_media_record_id_sort_order_key" ON "record_media"("record_id", "sort_order");
CREATE INDEX "record_media_media_id_idx" ON "record_media"("media_id");

ALTER TABLE "media" ADD CONSTRAINT "media_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media" ADD CONSTRAINT "media_baby_id_fkey" FOREIGN KEY ("baby_id") REFERENCES "babies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "babies" ADD CONSTRAINT "babies_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "records" ADD CONSTRAINT "records_baby_id_fkey" FOREIGN KEY ("baby_id") REFERENCES "babies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "records" ADD CONSTRAINT "records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "records" ADD CONSTRAINT "records_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "records" ADD CONSTRAINT "records_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_records" ADD CONSTRAINT "measurement_records_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "record_media" ADD CONSTRAINT "record_media_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "record_media" ADD CONSTRAINT "record_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
