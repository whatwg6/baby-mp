import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash } from 'node:crypto'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { Environment } from '../config/environment'

export interface StoredObjectMetadata {
  contentLength: number | null
  contentType: string | null
}

export interface StoredStreamResult {
  sizeBytes: number
  sha256: string
}

@Injectable()
export class S3StorageService {
  private readonly client: S3Client
  readonly bucket: string

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {
    this.bucket = config.get('S3_BUCKET', { infer: true })
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    })
  }

  async createUploadUrl(objectKey: string, mimeType: string, sizeBytes: number): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    }), { expiresIn: 10 * 60 })
  }

  async createAccessUrl(objectKey: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    }), { expiresIn: 5 * 60 })
  }

  async createExportDownloadUrl(
    objectKey: string,
    exportId: string,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentType: 'application/zip',
      ResponseContentDisposition: `attachment; filename="baby-growth-export-${exportId}.zip"`,
    }), { expiresIn: expiresInSeconds })
  }

  async head(objectKey: string): Promise<StoredObjectMetadata | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }))
      return {
        contentLength: result.ContentLength ?? null,
        contentType: result.ContentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null,
      }
    } catch (error) {
      if (this.statusCode(error) === 404 || this.errorName(error) === 'NotFound') return null
      throw error
    }
  }

  async checkBucketReachable(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }))
  }

  async read(objectKey: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }))
    if (!result.Body) throw new Error('Object body is unavailable')
    return result.Body.transformToByteArray()
  }

  async readStream(objectKey: string): Promise<AsyncIterable<Uint8Array>> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }))
    if (!result.Body || !(Symbol.asyncIterator in result.Body)) {
      throw new Error('Object body is unavailable')
    }
    return result.Body as AsyncIterable<Uint8Array>
  }

  async uploadMultipart(
    objectKey: string,
    mimeType: string,
    body: AsyncIterable<Uint8Array>,
  ): Promise<StoredStreamResult> {
    const created = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
      CacheControl: 'private, no-store',
    }))
    if (!created.UploadId) throw new Error('Multipart upload was not created')

    const uploadId = created.UploadId
    const partSize = 8 * 1024 * 1024
    const completedParts: Array<{ ETag: string; PartNumber: number }> = []
    const digest = createHash('sha256')
    let buffered = Buffer.alloc(0)
    let sizeBytes = 0
    let partNumber = 1

    const uploadPart = async (part: Buffer) => {
      const uploaded = await this.client.send(new UploadPartCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: part,
        ContentLength: part.byteLength,
      }))
      if (!uploaded.ETag) throw new Error('Multipart upload part has no ETag')
      completedParts.push({ ETag: uploaded.ETag, PartNumber: partNumber })
      partNumber += 1
    }

    try {
      for await (const value of body) {
        const chunk = Buffer.from(value)
        if (chunk.byteLength === 0) continue
        sizeBytes += chunk.byteLength
        digest.update(chunk)
        buffered = buffered.byteLength === 0 ? chunk : Buffer.concat([buffered, chunk])
        while (buffered.byteLength >= partSize) {
          await uploadPart(buffered.subarray(0, partSize))
          buffered = Buffer.from(buffered.subarray(partSize))
        }
      }
      if (buffered.byteLength > 0) await uploadPart(buffered)
      if (completedParts.length === 0) throw new Error('Refusing to store an empty export')
      await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: { Parts: completedParts },
      }))
      return { sizeBytes, sha256: digest.digest('hex') }
    } catch (error) {
      await this.client.send(new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: objectKey,
        UploadId: uploadId,
      })).catch(() => undefined)
      throw error
    }
  }

  async abortStaleMultipartUploads(prefix: string, initiatedBefore: Date): Promise<number> {
    let keyMarker: string | undefined
    let uploadIdMarker: string | undefined
    let aborted = 0
    let hasMore = true
    while (hasMore) {
      const result = await this.client.send(new ListMultipartUploadsCommand({
        Bucket: this.bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
        MaxUploads: 100,
      }))
      for (const upload of result.Uploads ?? []) {
        if (
          !upload.Key ||
          !upload.UploadId ||
          !upload.Initiated ||
          upload.Initiated > initiatedBefore
        ) {
          continue
        }
        await this.client.send(new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }))
        aborted += 1
      }
      hasMore = result.IsTruncated === true
      if (!hasMore) break
      keyMarker = result.NextKeyMarker
      uploadIdMarker = result.NextUploadIdMarker
      if (!keyMarker && !uploadIdMarker) {
        throw new Error('Multipart upload listing did not provide a continuation marker')
      }
    }
    return aborted
  }

  async promote(sourceKey: string, destinationKey: string, mimeType: string): Promise<void> {
    const encodedSource = `${encodeURIComponent(this.bucket)}/${sourceKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: destinationKey,
      CopySource: encodedSource,
      ContentType: mimeType,
      MetadataDirective: 'REPLACE',
    }))
  }

  private statusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined
    const metadata = '$metadata' in error ? error.$metadata : undefined
    return metadata && typeof metadata === 'object' && 'httpStatusCode' in metadata
      ? Number(metadata.httpStatusCode)
      : undefined
  }

  private errorName(error: unknown): string | undefined {
    return error && typeof error === 'object' && 'name' in error ? String(error.name) : undefined
  }
}
