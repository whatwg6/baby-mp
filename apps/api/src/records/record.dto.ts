import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { MediaDto } from '../media/media.dto'

export class MeasurementInputDto {
  @ApiPropertyOptional({ type: Number, minimum: 20, maximum: 250, nullable: true })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(20) @Max(250)
  heightCm?: number | null

  @ApiPropertyOptional({ type: Number, minimum: 0.2, maximum: 300, nullable: true })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.2) @Max(300)
  weightKg?: number | null
}

export class CreateRecordDto {
  @ApiProperty({ type: String, enum: ['note', 'measurement', 'milestone'] })
  @IsIn(['note', 'measurement', 'milestone'])
  type!: 'note' | 'measurement' | 'milestone'

  @ApiPropertyOptional({ type: String, maxLength: 60 })
  @IsOptional() @IsString() @Length(1, 60)
  title?: string

  @ApiPropertyOptional({ type: String, maxLength: 2_000, nullable: true })
  @IsOptional() @IsString() @Length(0, 2_000)
  content?: string | null

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString({ strict: true })
  occurredAt!: string

  @ApiProperty({ type: [String], format: 'uuid', maxItems: 9 })
  @IsArray() @ArrayMaxSize(9) @IsUUID('all', { each: true })
  mediaIds!: string[]

  @ApiPropertyOptional({ type: () => MeasurementInputDto })
  @IsOptional() @ValidateNested() @Type(() => MeasurementInputDto)
  measurement?: MeasurementInputDto
}

export class UpdateRecordDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt() @Min(1)
  version!: number

  @ApiPropertyOptional({ type: String, maxLength: 60, nullable: true })
  @IsOptional() @IsString() @Length(1, 60)
  title?: string | null

  @ApiPropertyOptional({ type: String, maxLength: 2_000, nullable: true })
  @IsOptional() @IsString() @Length(0, 2_000)
  content?: string | null

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional() @IsDateString({ strict: true })
  occurredAt?: string

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 9 })
  @IsOptional() @IsArray() @ArrayMaxSize(9) @IsUUID('all', { each: true })
  mediaIds?: string[]

  @ApiPropertyOptional({ type: () => MeasurementInputDto })
  @IsOptional() @ValidateNested() @Type(() => MeasurementInputDto)
  measurement?: MeasurementInputDto
}

export class TimelineQueryDto {
  @ApiPropertyOptional({ type: String, enum: ['note', 'measurement', 'milestone'] })
  @IsOptional() @IsIn(['note', 'measurement', 'milestone'])
  type?: 'note' | 'measurement' | 'milestone'

  @ApiPropertyOptional({ type: String }) @IsOptional() @IsString() @Length(1, 1024)
  cursor?: string

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number

  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @IsDateString({ strict: true })
  startAt?: string

  @ApiPropertyOptional({ type: String, format: 'date-time' }) @IsOptional() @IsDateString({ strict: true })
  endAt?: string
}

export class DeleteRecordQueryDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1)
  version!: number
}

class UserSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ nullable: true, type: String }) displayName!: string | null
  @ApiProperty({ nullable: true, type: String, format: 'uri' }) avatarUrl!: string | null
}

class RecordPermissionsDto {
  @ApiProperty({ type: Boolean }) canEdit!: boolean
  @ApiProperty({ type: Boolean }) canDelete!: boolean
}

export class RecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String, format: 'uuid' }) babyId!: string
  @ApiProperty({ type: String, enum: ['note', 'measurement', 'milestone'] }) type!: string
  @ApiProperty({ nullable: true, type: String }) title!: string | null
  @ApiProperty({ nullable: true, type: String }) content!: string | null
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string
  @ApiProperty({ nullable: true, type: () => MeasurementInputDto }) measurement!: MeasurementInputDto | null
  @ApiProperty({ type: () => MediaDto, isArray: true }) media!: MediaDto[]
  @ApiProperty({ type: () => UserSummaryDto }) createdBy!: UserSummaryDto
  @ApiProperty({ type: () => RecordPermissionsDto }) permissions!: RecordPermissionsDto
  @ApiProperty({ type: Number, minimum: 1 }) version!: number
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string
}

export class RecordResponseDto {
  @ApiProperty({ type: () => RecordDto }) data!: RecordDto
}

class TimelineMetaDto {
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null
}

export class TimelineResponseDto {
  @ApiProperty({ type: () => RecordDto, isArray: true }) data!: RecordDto[]
  @ApiProperty({ type: () => TimelineMetaDto }) meta!: TimelineMetaDto
}
