import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import type { TeamMember } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import {
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTag } from '../openapi/api-tags';
import { InvitationTokenDto } from './dto/invitation-token.dto';
import { TeamMemberResponseDto } from './dto/team-response.dto';
import { UpdatePermissionsDto } from './dto/update-permissions.dto';
import { TeamService } from './team.service';

/** Cross-event team actions: token-based invite responses and member management. */
@ApiTags(ApiTag.Team)
@ApiBearerAuth()
@Controller()
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /**
   * List the caller's active memberships across all events.
   */
  @Get('me/memberships')
  @ApiStandardResponse(TeamMemberResponseDto, {
    description: 'Your active memberships',
    isArray: true,
  })
  myMemberships(@CurrentUser() user: AuthUser): Promise<TeamMember[]> {
    return this.team.listMyMemberships(user.id);
  }

  /**
   * Accept a team invitation via its token.
   * @remarks Activates the membership and links it to the calling account.
   */
  @Post('team/invitations/accept')
  @HttpCode(200)
  @ApiStandardResponse(TeamMemberResponseDto, {
    description: 'The activated membership',
  })
  @ApiProblemResponse(404, 'Unknown token')
  @ApiProblemResponse(400, 'Invitation not pending or expired')
  accept(
    @CurrentUser() user: AuthUser,
    @Body() dto: InvitationTokenDto,
  ): Promise<TeamMember> {
    return this.team.acceptInvitation(user, dto.token);
  }

  /**
   * Decline a team invitation via its token.
   */
  @Post('team/invitations/decline')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Declined' })
  @ApiProblemResponse(404, 'Unknown token')
  @ApiProblemResponse(400, 'Invitation not pending or expired')
  decline(@Body() dto: InvitationTokenDto): Promise<void> {
    return this.team.declineInvitation(dto.token);
  }

  /**
   * Cancel a pending invitation.
   * @remarks Owner only (of the invitation's event).
   */
  @Delete('team/invitations/:invitationId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Cancelled' })
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Invitation not found')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    return this.team.cancelInvitation(user.id, invitationId);
  }

  /**
   * Update a collaborator's module permissions.
   * @remarks Owner only. Cannot target the owner or an inactive member.
   */
  @Patch('team/members/:teamMemberId/permissions')
  @ApiStandardResponse(TeamMemberResponseDto, {
    description: 'The updated membership',
  })
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Member not found')
  @ApiProblemResponse(400, 'Target is the owner or inactive')
  updatePermissions(
    @CurrentUser() user: AuthUser,
    @Param('teamMemberId') teamMemberId: string,
    @Body() dto: UpdatePermissionsDto,
  ): Promise<TeamMember> {
    return this.team.updatePermissions(
      user.id,
      teamMemberId,
      dto.modulePermissions,
    );
  }

  /**
   * Remove a collaborator from the team.
   * @remarks Owner only. Owners cannot be removed this way.
   */
  @Delete('team/members/:teamMemberId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Member not found')
  @ApiProblemResponse(400, 'Target is the owner or already removed')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('teamMemberId') teamMemberId: string,
  ): Promise<void> {
    return this.team.removeMember(user.id, teamMemberId);
  }
}
