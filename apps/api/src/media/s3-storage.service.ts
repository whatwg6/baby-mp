import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { Environment } from '../config/environment'

export interface StoredObjectMetadata {
  contentLength: number | null
  contentType: string | null
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

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }))
  }

  async read(objectKey: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }))
    if (!result.Body) throw new Error('Object body is unavailable')
    return result.Body.transformToByteArray()
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
