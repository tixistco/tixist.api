import { ForbiddenException, Injectable } from '@nestjs/common';
import { TeamMemberStatus, TeamRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipContext, ModuleName } from './permissions.types';

/**
 * Event-scoped authorization. Resolves the caller's active team membership and
 * answers the three questions the guards ask: are you a member, do you hold a
 * module, are you the owner. Ported from the source app's `permissions.ts`.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Caller must be an ACTIVE member (owner or collaborator) of the event. */
  async checkEventAccess(
    eventId: string,
    userId: string,
  ): Promise<MembershipContext> {
    const membership = await this.prisma.teamMember.findFirst({
      where: { eventId, userId, status: TeamMemberStatus.ACTIVE },
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this event');
    }
    return { membership, isOwner: membership.role === TeamRole.OWNER };
  }

  /** Owners bypass; collaborators must hold the required module. */
  async checkModuleAccess(
    eventId: string,
    userId: string,
    requiredModule: ModuleName,
  ): Promise<MembershipContext> {
    const ctx = await this.checkEventAccess(eventId, userId);
    if (ctx.isOwner) return ctx;
    if (!ctx.membership.modulePermissions.includes(requiredModule)) {
      throw new ForbiddenException(
        `You don't have access to the ${requiredModule} module`,
      );
    }
    return ctx;
  }

  /** Owner-only actions (team management, settings, destructive event ops). */
  async checkIsOwner(
    eventId: string,
    userId: string,
  ): Promise<MembershipContext> {
    const ctx = await this.checkEventAccess(eventId, userId);
    if (!ctx.isOwner) {
      throw new ForbiddenException('Only event owners can perform this action');
    }
    return ctx;
  }
}
