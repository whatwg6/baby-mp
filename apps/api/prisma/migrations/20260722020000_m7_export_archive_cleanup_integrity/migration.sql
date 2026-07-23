-- Export workers create a zero-byte media row before streaming an archive. If
-- generation fails, or the worker crashes before linking the row to a job, the
-- cleanup path must be able to tombstone that placeholder without inventing a
-- positive size for an object that was never completed.
ALTER TABLE "media" DROP CONSTRAINT "media_size_positive";
ALTER TABLE "media" ADD CONSTRAINT "media_size_positive" CHECK (
  "size_bytes" > 0
  OR (
    "purpose" = 'export_archive'
    AND "status" IN ('pending', 'deleted')
    AND "size_bytes" = 0
  )
);
