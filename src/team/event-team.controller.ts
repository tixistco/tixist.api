import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Invitation, TeamMember } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import {
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTag } from '../openapi/api-tags';
import { EventAccessGuard, OwnerGuard } from '../permissions/event-rbac.guards';
import { CurrentMembership } from '../permissions/current-membership.decorator';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ListMembersQuery } from './dto/list-members.query';
import {
  InvitationResponseDto,
  TeamMemberResponseDto,
} from './dto/team-response.dto';
import { TeamService } from './team.service';

/** Team management scoped to one event (`/events/{eventId}/team`). */
@ApiTags(ApiTag.Team)
@ApiBearerAuth()
@Controller('events/:eventId/team')
export class EventTeamController {
  constructor(private readonly team: TeamService) {}

  /**
   * Get the caller's membership for this event.
   * @remarks Any active member (owner or collaborator) may read their own membership.
   */
  @Get('me')
  @UseGuards(EventAccessGuard)
  @ApiStandardResponse(TeamMemberResponseDto, {
    description: 'Your membership',
  })
  @ApiProblemResponse(403, 'Not a member of this event')
  getMyMembership(@CurrentMembership() membership: TeamMember): TeamMember {
    return membership;
  }

  /**
   * List the event's team members.
   * @remarks Owner only. Optionally filter by status.
   */
  @Get('members')
  @UseGuards(OwnerGuard)
  @ApiStandardResponse(TeamMemberResponseDto, {
    description: 'Team members',
    isArray: true,
  })
  @ApiProblemResponse(403, 'Not the owner')
  listMembers(
    @Param('eventId') eventId: string,
    @Query() query: ListMembersQuery,
  ): Promise<TeamMember[]> {
    return this.team.listMembers(eventId, query.status);
  }

  /**
   * Invite a collaborator with module-scoped permissions.
   * @remarks Owner only. Creates a pending invitation (7-day token) and a pending member.
   */
  @Post('invitations')
  @UseGuards(OwnerGuard)
  @HttpCode(201)
  @ApiStandardResponse(InvitationResponseDto, {
    status: 201,
    description: 'Invitation created',
  })
  @ApiProblemResponse(400, 'Self-invite, already a member, or already invited')
  @ApiProblemResponse(403, 'Not the owner')
  async invite(
    @Param('eventId') eventId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteMemberDto,
  ): Promise<Invitation> {
    const { invitation } = await this.team.invite(eventId, user, dto);
    return invitation;
  }

  /**
   * List pending invitations for the event.
   * @remarks Owner only.
   */
  @Get('invitations/pending')
  @UseGuards(OwnerGuard)
  @ApiStandardResponse(InvitationResponseDto, {
    description: 'Pending invitations',
    isArray: true,
  })
  @ApiProblemResponse(403, 'Not the owner')
  listPending(@Param('eventId') eventId: string): Promise<Invitation[]> {
    return this.team.listPendingInvitations(eventId);
  }
}
