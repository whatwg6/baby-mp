import { Type } from 'class-transformer'
import {
  IsHexadecimal,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateMediaUploadDto {
  @ApiProperty({ type: String, maxLength: 255, example: 'photo.jpg' })
  @IsString()
  @Length(1, 255)
  fileName!: string

  @ApiProperty({ type: String, enum: ['image/jpeg', 'image/png'] })
  @IsString()
  mimeType!: string

  @ApiProperty({ type: Number, minimum: 1, maximum: 20_971_520 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number

  @ApiPropertyOptional({ type: String, pattern: '^[a-fA-F0-9]{64}$' })
  @IsOptional()
  @IsHexadecimal()
  @Length(64, 64)
  sha256?: string
}

export class CompleteMediaUploadDto {
  @ApiProperty({ type: Number, minimum: 1, maximum: 20_000 })
  @IsInt()
  @Min(1)
  @Max(20_000)
  width!: number

  @ApiProperty({ type: Number, minimum: 1, maximum: 20_000 })
  @IsInt()
  @Min(1)
  @Max(20_000)
  height!: number
}

export class MediaDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String }) mimeType!: string
  @ApiProperty({ type: Number, nullable: true }) width!: number | null
  @ApiProperty({ type: Number, nullable: true }) height!: number | null
  @ApiProperty({ type: Number }) sizeBytes!: number
  @ApiProperty({ type: String, enum: ['pending', 'uploaded', 'ready', 'failed', 'deleted'] }) status!: string
  @ApiProperty({ type: String, format: 'uri', nullable: true }) accessUrl!: string | null
  @ApiPropertyOptional({ type: Number, minimum: 0 }) sortOrder?: number
}

export class MediaResponseDto {
  @ApiProperty({ type: () => MediaDto }) data!: MediaDto
}

class UploadInstructionDto {
  @ApiProperty({ type: String, enum: ['PUT'] }) method!: 'PUT'
  @ApiProperty({ type: String, format: 'uri' }) url!: string
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) headers!: Record<string, string>
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string
}

class MediaUploadDataDto {
  @ApiProperty({ type: String, format: 'uuid' }) mediaId!: string
  @ApiProperty({ type: () => UploadInstructionDto }) upload!: UploadInstructionDto
}

export class MediaUploadResponseDto {
  @ApiProperty({ type: () => MediaUploadDataDto }) data!: MediaUploadDataDto
}
