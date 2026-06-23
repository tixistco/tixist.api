import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTag } from '../openapi/api-tags';
import type { AuthUser } from '../auth/auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  EventsSummaryDto,
  ProfileResponseDto,
  ProfileWithCountsDto,
} from './dto/profile-response.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  EventsSummary,
  UserProfileWithCounts,
  UsersService,
} from './users.service';

@ApiTags(ApiTag.Users)
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Get the current user's profile.
   * @remarks Returns the authenticated caller's own account details.
   */
  @Get()
  @ApiStandardResponse(ProfileWithCountsDto, {
    description: 'The current user (with event/registration counts)',
  })
  @ApiProblemResponse(401, 'Missing/invalid access token')
  getProfile(@CurrentUser() user: AuthUser): Promise<UserProfileWithCounts> {
    return this.users.getProfile(user.id);
  }

  /**
   * Summary of the current user's events.
   * @remarks Totals for all/active/archived events plus total attendees across them.
   */
  @Get('events-summary')
  @ApiStandardResponse(EventsSummaryDto, { description: 'Events rollup' })
  @ApiProblemResponse(401, 'Missing/invalid access token')
  eventsSummary(@CurrentUser() user: AuthUser): Promise<EventsSummary> {
    return this.users.eventsSummary(user.id);
  }

  /**
   * Update the current user's profile.
   * @remarks Patch any subset of name, email and image. Changing the email resets
   * email verification, and the new email must not already be in use.
   */
  @Patch()
  @ApiStandardResponse(ProfileResponseDto, { description: 'The updated user' })
  @ApiProblemResponse(409, 'Email already in use')
  @ApiProblemResponse(400, 'Validation failed')
  @ApiProblemResponse(401, 'Missing/invalid access token')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.users.updateProfile(user.id, dto);
  }

  /**
   * Change the current user's password.
   * @remarks Requires the current password for verification. Accounts without a
   * password set (external identities) cannot use this endpoint.
   */
  @Post('change-password')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiProblemResponse(401, 'Current password incorrect / not authenticated')
  @ApiProblemResponse(400, 'No password set, or validation failed')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.users.changePassword(user.id, dto);
  }
}
