import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString, Length, MaxLength, MinLength, ValidateBy } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import {
  API_ERROR_CODES,
  displayNameSchema,
  type ApiErrorCode,
  type PlatformType,
} from '@baby-mp/contracts'

export class ApiErrorDetailDto {
  @ApiPropertyOptional({ type: String, example: 'birthDate' })
  field?: string

  @ApiProperty({ type: String, example: 'must be a valid date' })
  reason!: string
}

export class ApiErrorDto {
  @ApiProperty({
    type: String,
    enum: API_ERROR_CODES,
    example: 'VALIDATION_FAILED',
  })
  code!: ApiErrorCode

  @ApiProperty({ type: String, example: '提交内容有误' })
  message!: string

  @ApiProperty({ type: String, example: 'req_0198f76a-cd42-7000-8000-000000000001' })
  requestId!: string

  @ApiPropertyOptional({ type: () => [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[]
}

export class ApiErrorResponseDto {
  @ApiProperty({ type: () => ApiErrorDto })
  error!: ApiErrorDto
}

export class UserSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string

  @ApiProperty({ nullable: true, type: String, example: '测试妈妈' })
  displayName!: string | null

  @ApiProperty({ format: 'uri', nullable: true, type: String })
  avatarUrl!: string | null
}

export class AuthSessionDto {
  @ApiProperty({ type: String, writeOnly: true })
  accessToken!: string

  @ApiProperty({ type: String, format: 'date-time' })
  accessTokenExpiresAt!: string

  @ApiProperty({ type: String, writeOnly: true })
  refreshToken!: string

  @ApiProperty({ type: String, format: 'date-time' })
  refreshTokenExpiresAt!: string

  @ApiProperty({ type: () => UserSummaryDto })
  user!: UserSummaryDto
}

export class AuthSessionResponseDto {
  @ApiProperty({ type: () => AuthSessionDto })
  data!: AuthSessionDto
}

export class CurrentUserDto extends UserSummaryDto {
  @ApiProperty({ type: String, enum: ['active'], example: 'active' })
  status!: string
}

export class CurrentUserResponseDto {
  @ApiProperty({ type: () => CurrentUserDto })
  data!: CurrentUserDto
}

export class PlatformLoginDto {
  @ApiProperty({ type: String, enum: ['wechat_mini', 'alipay_mini', 'douyin_mini', 'h5'] })
  @IsIn(['wechat_mini', 'alipay_mini', 'douyin_mini', 'h5'])
  platform!: PlatformType

  @ApiProperty({ type: String, description: 'Temporary platform credential', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code!: string
}

export class MockLoginDto {
  @ApiProperty({ type: String, example: 'parent-a' })
  @IsString()
  @Length(1, 80)
  mockUserKey!: string

  @ApiPropertyOptional({ type: String, maxLength: 80 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateBy({
    name: 'isDisplayName',
    validator: {
      validate: (value: unknown) => displayNameSchema.safeParse(value).success,
      defaultMessage: () => 'displayName must contain 1–80 Unicode characters',
    },
  })
  displayName?: string
}

export class RefreshDto {
  @ApiProperty({ type: String, writeOnly: true })
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refreshToken!: string
}
