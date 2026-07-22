import { Transform } from 'class-transformer'
import { ValidateBy } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  displayNameSchema,
} from '@baby-mp/contracts'

export class UpdateCurrentUserDto {
  @ApiProperty({ type: String, minLength: DISPLAY_NAME_MIN_LENGTH, maxLength: DISPLAY_NAME_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateBy({
    name: 'isDisplayName',
    validator: {
      validate: (value: unknown) => displayNameSchema.safeParse(value).success,
      defaultMessage: () => 'displayName must contain 1–80 Unicode characters',
    },
  })
  displayName!: string
}

export class UserSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string

  @ApiProperty({ nullable: true, type: String, maxLength: DISPLAY_NAME_MAX_LENGTH })
  displayName!: string | null

  @ApiProperty({ format: 'uri', nullable: true, type: String })
  avatarUrl!: string | null
}

export class UserSummaryResponseDto {
  @ApiProperty({ type: () => UserSummaryDto })
  data!: UserSummaryDto
}
