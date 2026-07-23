ALTER TABLE "data_rights_requests"
  ADD CONSTRAINT "data_rights_requests_lifecycle_check"
  CHECK (
    (
      "status" IN ('pending', 'processing')
      AND "active_request_key" IS NOT NULL
      AND "resolved_at" IS NULL
    )
    OR
    (
      "status" IN ('completed', 'rejected', 'cancelled')
      AND "active_request_key" IS NULL
      AND "resolved_at" IS NOT NULL
    )
  );

ALTER TABLE "data_rights_requests"
  ADD CONSTRAINT "data_rights_requests_account_scope_check"
  CHECK ("type" <> 'account_deletion' OR "baby_id" IS NULL);
