import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsUUID } from 'class-validator'

export class CreateDataRightsRequestDto {
  @ApiProperty({
    enum: ['account_deletion', 'data_access', 'correction'],
  })
  @IsIn(['account_deletion', 'data_access', 'correction'])
  type!: 'account_deletion' | 'data_access' | 'correction'

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Optional current baby scope; account deletion is always account-scoped.',
  })
  @IsOptional()
  @IsUUID()
  babyId?: string | null
}

export class DataRightsRequestDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string

  @ApiProperty({ enum: ['account_deletion', 'data_access', 'correction'] })
  type!: string

  @ApiProperty({ enum: ['pending', 'processing', 'completed', 'rejected', 'cancelled'] })
  status!: string

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  babyId!: string | null

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null
}

export class DataRightsRequestResponseDto {
  @ApiProperty({ type: () => DataRightsRequestDto })
  data!: DataRightsRequestDto
}

export class DataRightsRequestListResponseDto {
  @ApiProperty({ type: () => DataRightsRequestDto, isArray: true })
  data!: DataRightsRequestDto[]
}
