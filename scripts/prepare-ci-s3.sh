#!/usr/bin/env bash
set -euo pipefail

: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_REGION:?S3_REGION is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export CI_S3_LIFECYCLE_PATH="$repo_root/scripts/s3-export-lifecycle.json"

pnpm --filter @baby-mp/api exec tsx -e '
  import { readFileSync } from "node:fs";
  import {
    CreateBucketCommand,
    HeadBucketCommand,
    PutBucketLifecycleConfigurationCommand,
    PutObjectCommand,
    S3Client,
  } from "@aws-sdk/client-s3";
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
  const bucket = process.env.S3_BUCKET;
  void (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const lifecycle = JSON.parse(readFileSync(process.env.CI_S3_LIFECYCLE_PATH, "utf8"));
    await client.send(new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: lifecycle,
    }));
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "operations/private-probe.txt",
      Body: "synthetic CI private-access probe\n",
      ContentType: "text/plain",
    }));
    console.log("CI object-storage bucket, lifecycle, and private probe are ready.");
  })();
'
