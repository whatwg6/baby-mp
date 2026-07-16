import { IsIn, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import type { PlatformType } from '@baby-mp/contracts'

export class ApiErrorDetailDto {
  @ApiPropertyOptional({ type: String, example: 'birthDate' })
  field?: string

  @ApiProperty({ type: String, example: 'must be a valid date' })
  reason!: string
}

export class ApiErrorDto {
  @ApiProperty({
    type: String,
    enum: [
      'AUTH_REQUIRED',
      'REFRESH_TOKEN_INVALID',
      'FORBIDDEN',
      'RESOURCE_NOT_FOUND',
      'VALIDATION_FAILED',
      'VERSION_CONFLICT',
      'IDEMPOTENCY_CONFLICT',
      'CONFLICT',
      'INTERNAL_ERROR',
    ],
    example: 'VALIDATION_FAILED',
  })
  code!: string

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
  @IsString()
  @Length(1, 80)
  displayName?: string
}

export class RefreshDto {
  @ApiProperty({ type: String, writeOnly: true })
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  refreshToken!: string
}
