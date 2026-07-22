import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class BabyDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string

  @ApiProperty({ type: String, maxLength: 40 })
  name!: string

  @ApiProperty({ type: String, enum: ['male', 'female', 'unspecified'] })
  gender!: 'male' | 'female' | 'unspecified'

  @ApiProperty({ type: String, format: 'date', example: '2025-12-01' })
  birthDate!: string

  @ApiProperty({ nullable: true, type: String, example: '08:30' })
  birthTime!: string | null

  @ApiProperty({ nullable: true, type: Number, example: 50.2 })
  birthHeightCm!: number | null

  @ApiProperty({ nullable: true, type: Number, example: 3.42 })
  birthWeightKg!: number | null

  @ApiProperty({ format: 'uri', nullable: true, type: String })
  avatarUrl!: string | null

  @ApiProperty({ type: String, enum: ['admin', 'editor', 'viewer'] })
  role!: 'admin' | 'editor' | 'viewer'

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string
}

export class BabyResponseDto {
  @ApiProperty({ type: () => BabyDto })
  data!: BabyDto
}

export class BabyListResponseDto {
  @ApiProperty({ isArray: true, type: () => BabyDto })
  data!: BabyDto[]
}

export class CreateBabyDto {
  @ApiProperty({ type: String, maxLength: 40 })
  @IsString()
  @Length(1, 40)
  name!: string

  @ApiProperty({ type: String, enum: ['male', 'female', 'unspecified'] })
  @IsIn(['male', 'female', 'unspecified'])
  gender!: 'male' | 'female' | 'unspecified'

  @ApiProperty({ type: String, example: '2025-12-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate!: string

  @ApiPropertyOptional({ type: String, example: '08:30' })
  @IsOptional()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  birthTime?: string

  @ApiPropertyOptional({ type: Number, minimum: 20, maximum: 250 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(250)
  birthHeightCm?: number

  @ApiPropertyOptional({ type: Number, minimum: 0.2, maximum: 300 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.2)
  @Max(300)
  birthWeightKg?: number
}

export class UpdateBabyDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number

  @ApiPropertyOptional({ type: String, maxLength: 40 })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  name?: string

  @ApiPropertyOptional({ type: String, enum: ['male', 'female', 'unspecified'] })
  @IsOptional()
  @IsIn(['male', 'female', 'unspecified'])
  gender?: 'male' | 'female' | 'unspecified'

  @ApiPropertyOptional({ type: String, example: '2025-12-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate?: string

  @ApiPropertyOptional({ type: String, example: '08:30', nullable: true })
  @IsOptional()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  birthTime?: string | null

  @ApiPropertyOptional({ type: Number, minimum: 20, maximum: 250, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(250)
  birthHeightCm?: number | null

  @ApiPropertyOptional({ type: Number, minimum: 0.2, maximum: 300, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.2)
  @Max(300)
  birthWeightKg?: number | null

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  avatarMediaId?: string | null
}
