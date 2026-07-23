CREATE TABLE "worker_heartbeats" (
  "instance_id" UUID NOT NULL,
  "worker_name" VARCHAR(64) NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "last_success_at" TIMESTAMPTZ(3),
  "last_failure_at" TIMESTAMPTZ(3),
  "stopped_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("instance_id")
);

CREATE INDEX "worker_heartbeats_worker_name_stopped_at_last_success_at_idx"
  ON "worker_heartbeats"("worker_name", "stopped_at", "last_success_at" DESC);
