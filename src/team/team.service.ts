import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invitation, TeamMember } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PermissionsService } from '../permissions/permissions.service';
import { ModuleName } from '../permissions/permissions.types';
import { PrismaService } from '../prisma/prisma.service';
import { generateInvitationToken, invitationExpiry } from './invitation-token';

/** Human-readable reasons a non-pending invitation can't be acted on. */
const INVITATION_STATE_MESSAGE: Record<string, string> = {
  ACCEPTED: 'This invitation has already been accepted',
  DECLINED: 'This invitation was declined',
  CANCELLED: 'This invitation was cancelled by the organizer',
  EXPIRED: 'This invitation has expired',
};

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /** All members of an event's team (owner first), optionally filtered by status. */
  listMembers(
    eventId: string,
    status?: 'PENDING' | 'ACTIVE' | 'REMOVED',
  ): Promise<TeamMember[]> {
    return this.prisma.teamMember.findMany({
      where: { eventId, ...(status && { status }) },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Pending invitations for an event. */
  listPendingInvitations(eventId: string): Promise<Invitation[]> {
    return this.prisma.invitation.findMany({
      where: { eventId, status: 'PENDING' },
      orderBy: { sentAt: 'desc' },
    });
  }

  /** The current user's active memberships across all events. */
  listMyMemberships(userId: string): Promise<TeamMember[]> {
    return this.prisma.teamMember.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Invite a collaborator (owner-gated by the route). Creates a PENDING invitation
   * with a token and upserts the matching PENDING member (upsert tolerates a prior
   * DECLINED/REMOVED row under the `@@unique([eventId, email])` constraint).
   */
  async invite(
    eventId: string,
    inviter: AuthUser,
    input: { email: string; modulePermissions: ModuleName[] },
  ): Promise<{ invitation: Invitation; member: TeamMember }> {
    const email = input.email.toLowerCase();

    if (email === inviter.email?.toLowerCase()) {
      throw new BadRequestException(
        'Cannot invite yourself — you already own this event',
      );
    }

    const existing = await this.prisma.teamMember.findUnique({
      where: { eventId_email: { eventId, email } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new BadRequestException(
        "This email already has an active membership. Use 'update permissions' instead.",
      );
    }

    const pending = await this.prisma.invitation.findFirst({
      where: { eventId, email, status: 'PENDING' },
    });
    if (pending) {
      throw new BadRequestException(
        'An invitation has already been sent to this email. Resend it instead.',
      );
    }

    const token = generateInvitationToken();
    const expiresAt = invitationExpiry(new Date());

    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.create({
        data: {
          eventId,
          email,
          token,
          modulePermissions: input.modulePermissions,
          status: 'PENDING',
          expiresAt,
          sentById: inviter.id,
        },
      });
      const member = await tx.teamMember.upsert({
        where: { eventId_email: { eventId, email } },
        create: {
          eventId,
          email,
          role: 'COLLABORATOR',
          status: 'PENDING',
          modulePermissions: input.modulePermissions,
          invitedById: inviter.id,
        },
        update: {
          role: 'COLLABORATOR',
          status: 'PENDING',
          modulePermissions: input.modulePermissions,
          invitedById: inviter.id,
          invitedAt: new Date(),
          userId: null,
        },
      });
      return { invitation, member };
    });
  }

  /** Accept an invitation by token: activate the membership and link the user. */
  async acceptInvitation(user: AuthUser, token: string): Promise<TeamMember> {
    const invitation = await this.loadActionableInvitation(token);

    const alreadyActive = await this.prisma.teamMember.findFirst({
      where: { eventId: invitation.eventId, userId: user.id, status: 'ACTIVE' },
    });
    if (alreadyActive) {
      throw new BadRequestException(
        'You already have an active membership for this event',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      const member = await tx.teamMember.findUnique({
        where: {
          eventId_email: {
            eventId: invitation.eventId,
            email: invitation.email,
          },
        },
      });
      if (!member) {
        throw new NotFoundException('Team member record not found');
      }
      return tx.teamMember.update({
        where: { id: member.id },
        data: { status: 'ACTIVE', userId: user.id, lastAccessedAt: new Date() },
      });
    });
  }

  /** Decline an invitation by token: mark declined and drop the pending member. */
  async declineInvitation(token: string): Promise<void> {
    const invitation = await this.loadActionableInvitation(token);
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'DECLINED', respondedAt: new Date() },
      });
      await tx.teamMember.deleteMany({
        where: {
          eventId: invitation.eventId,
          email: invitation.email,
          status: 'PENDING',
        },
      });
    });
  }

  /** Update a collaborator's module permissions (owner-only; not the owner's own). */
  async updatePermissions(
    callerId: string,
    teamMemberId: string,
    modulePermissions: ModuleName[],
  ): Promise<TeamMember> {
    const member = await this.requireMember(teamMemberId);
    await this.permissions.checkIsOwner(member.eventId, callerId);

    if (member.role === 'OWNER') {
      throw new BadRequestException(
        "Cannot modify the owner's permissions — owners have full access",
      );
    }
    if (member.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Cannot update permissions for an inactive member',
      );
    }
    return this.prisma.teamMember.update({
      where: { id: teamMemberId },
      data: { modulePermissions },
    });
  }

  /** Remove a collaborator (owner-only; owners can't be removed this way). */
  async removeMember(callerId: string, teamMemberId: string): Promise<void> {
    const member = await this.requireMember(teamMemberId);
    await this.permissions.checkIsOwner(member.eventId, callerId);

    if (member.role === 'OWNER') {
      throw new BadRequestException(
        'Cannot remove the owner. Transfer ownership first.',
      );
    }
    if (member.status === 'REMOVED') {
      throw new BadRequestException('This member has already been removed');
    }
    await this.prisma.teamMember.update({
      where: { id: teamMemberId },
      data: { status: 'REMOVED' },
    });
  }

  /** Cancel a pending invitation (owner-only). */
  async cancelInvitation(
    callerId: string,
    invitationId: string,
  ): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    await this.permissions.checkIsOwner(invitation.eventId, callerId);

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(
        'Only pending invitations can be cancelled',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
      await tx.teamMember.deleteMany({
        where: {
          eventId: invitation.eventId,
          email: invitation.email,
          status: 'PENDING',
        },
      });
    });
  }

  // --- helpers ---

  /** Load an invitation by token and assert it is still actionable (PENDING, unexpired). */
  private async loadActionableInvitation(token: string): Promise<Invitation> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found or invalid token');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(
        INVITATION_STATE_MESSAGE[invitation.status] ??
          'This invitation is no longer valid',
      );
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException(
        'This invitation has expired. Request a new one from the organizer.',
      );
    }
    return invitation;
  }

  private async requireMember(teamMemberId: string): Promise<TeamMember> {
    const member = await this.prisma.teamMember.findUnique({
      where: { id: teamMemberId },
    });
    if (!member) throw new NotFoundException('Team member not found');
    return member;
  }
}
