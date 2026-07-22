import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator'

import { BabyDto } from '../babies/baby.dto'

export class CreateFamilyInviteDto {
  @ApiProperty({ type: String, enum: ['editor', 'viewer'] })
  @IsIn(['editor', 'viewer'])
  role!: 'editor' | 'viewer'

  @ApiPropertyOptional({ type: Number, default: 24, minimum: 1, maximum: 168 })
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours = 24
}

export class InviteTokenDto {
  @ApiProperty({ type: String, description: 'Raw one-time invite token. It is accepted only in the JSON request body.' })
  @IsString()
  token!: string
}

export class UpdateFamilyMemberDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number

  @ApiProperty({ type: String, enum: ['admin', 'editor', 'viewer'] })
  @IsIn(['admin', 'editor', 'viewer'])
  role!: 'admin' | 'editor' | 'viewer'
}

export class DeleteFamilyMemberQueryDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number
}

export class FamilyUserSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String }) displayName!: string
  @ApiProperty({ type: String, nullable: true, format: 'uri' }) avatarUrl!: string | null
}

export class FamilyMemberDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: () => FamilyUserSummaryDto }) user!: FamilyUserSummaryDto
  @ApiProperty({ type: String, enum: ['admin', 'editor', 'viewer'] }) role!: string
  @ApiProperty({ type: String, enum: ['active', 'removed'] }) status!: string
  @ApiProperty({ type: String, format: 'date-time' }) joinedAt!: string
  @ApiProperty({ type: Number, minimum: 1 }) version!: number
  @ApiProperty({ type: Boolean }) isCurrentUser!: boolean
}

export class FamilyMemberListResponseDto {
  @ApiProperty({ type: () => FamilyMemberDto, isArray: true }) data!: FamilyMemberDto[]
}

export class FamilyMemberResponseDto {
  @ApiProperty({ type: () => FamilyMemberDto }) data!: FamilyMemberDto
}

export class FamilyInviteDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String, enum: ['editor', 'viewer'] }) role!: string
  @ApiProperty({ type: String, enum: ['pending', 'accepted', 'revoked', 'expired'] }) status!: string
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: () => FamilyUserSummaryDto }) inviter!: FamilyUserSummaryDto
}

export class FamilyInviteListResponseDto {
  @ApiProperty({ type: () => FamilyInviteDto, isArray: true }) data!: FamilyInviteDto[]
}

export class CreatedFamilyInviteDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String, enum: ['editor', 'viewer'] }) role!: string
  @ApiProperty({ type: String, enum: ['pending', 'accepted', 'revoked', 'expired'] }) status!: string
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string
  @ApiProperty({ type: () => FamilyUserSummaryDto }) inviter!: FamilyUserSummaryDto
  @ApiProperty({ type: String, description: 'Returned only as the result of the idempotent create operation.' }) token!: string
  @ApiProperty({ type: String, example: '/pages/family/invite?token=...' }) sharePath!: string
}

export class CreatedFamilyInviteResponseDto {
  @ApiProperty({ type: () => CreatedFamilyInviteDto }) data!: CreatedFamilyInviteDto
}

export class InvitePreviewBabyDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string
  @ApiProperty({ type: String }) name!: string
  @ApiProperty({ type: String, nullable: true, format: 'uri' }) avatarUrl!: string | null
}

export class InvitePreviewDto {
  @ApiProperty({ type: () => InvitePreviewBabyDto }) baby!: InvitePreviewBabyDto
  @ApiProperty({ type: () => FamilyUserSummaryDto }) inviter!: FamilyUserSummaryDto
  @ApiProperty({ type: String, enum: ['editor', 'viewer'] }) role!: string
  @ApiProperty({ type: String, enum: ['pending', 'accepted', 'revoked', 'expired'] }) status!: string
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string
}

export class InvitePreviewResponseDto {
  @ApiProperty({ type: () => InvitePreviewDto }) data!: InvitePreviewDto
}

export class AcceptedInviteResponseDto {
  @ApiProperty({ type: () => BabyDto }) baby!: BabyDto
  @ApiProperty({ type: () => FamilyMemberDto }) member!: FamilyMemberDto
}

export class AcceptedInviteSuccessResponseDto {
  @ApiProperty({ type: () => AcceptedInviteResponseDto }) data!: AcceptedInviteResponseDto
}
