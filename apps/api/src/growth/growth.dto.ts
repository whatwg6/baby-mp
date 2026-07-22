import { IsDateString, IsIn, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class GrowthQueryDto {
  @ApiProperty({ enum: ['height', 'weight'] })
  @IsIn(['height', 'weight'])
  metric!: 'height' | 'weight'

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional() @IsDateString({ strict: true })
  startAt?: string

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional() @IsDateString({ strict: true })
  endAt?: string
}

export class GrowthPointDto {
  @ApiProperty({ type: String, format: 'uuid' }) recordId!: string
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string
  @ApiProperty({ type: Number, minimum: 0, exclusiveMinimum: true }) value!: number
}

export class GrowthSeriesDto {
  @ApiProperty({ enum: ['height', 'weight'] }) metric!: 'height' | 'weight'
  @ApiProperty({ enum: ['cm', 'kg'] }) unit!: 'cm' | 'kg'
  @ApiProperty({ type: () => GrowthPointDto, isArray: true }) points!: GrowthPointDto[]
}

export class GrowthResponseDto {
  @ApiProperty({ type: () => GrowthSeriesDto }) data!: GrowthSeriesDto
}
