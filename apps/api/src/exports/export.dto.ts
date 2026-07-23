import { Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateExportDto {
  @ApiProperty({ type: Boolean, default: false })
  @IsBoolean()
  includeMedia!: boolean

  @ApiProperty({ type: String, enum: ['zip'], default: 'zip' })
  @IsIn(['zip'])
  format!: 'zip'
}

export class ExportListQueryDto {
  @ApiPropertyOptional({ type: String, maxLength: 1024 })
  @IsOptional() @IsString() @Length(1, 1024)
  cursor?: string

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number
}

export class ExportJobDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String, format: 'uuid' }) babyId!: string
  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'failed', 'expired'] }) status!: string
  @ApiProperty({ type: Boolean }) includeMedia!: boolean
  @ApiProperty({ enum: ['zip'] }) format!: 'zip'
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) expiresAt!: string | null
  @ApiPropertyOptional({ nullable: true, type: String, enum: [null] }) downloadUrl?: null
}

export class ExportResponseDto {
  @ApiProperty({ type: () => ExportJobDto }) data!: ExportJobDto
}

class ExportListMetaDto {
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null
}

export class ExportListResponseDto {
  @ApiProperty({ type: () => ExportJobDto, isArray: true }) data!: ExportJobDto[]
  @ApiProperty({ type: () => ExportListMetaDto }) meta!: ExportListMetaDto
}

class ExportDownloadDto {
  @ApiProperty({ type: String, format: 'uri' }) downloadUrl!: string
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string
}

export class ExportDownloadResponseDto {
  @ApiProperty({ type: () => ExportDownloadDto }) data!: ExportDownloadDto
}
