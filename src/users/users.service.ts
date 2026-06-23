import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUserService } from '../auth/auth-user.service';
import { HashingService } from '../auth/hashing.service';
import { EventStatus } from '../events/event.constants';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** Fields returned for the authenticated user's own profile. */
const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  image: true,
  emailVerified: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type UserProfile = Prisma.UserGetPayload<{
  select: typeof PROFILE_SELECT;
}>;

/** Profile plus rollups: events organized and registrations made. */
export type UserProfileWithCounts = UserProfile & {
  eventCount: number;
  registrationCount: number;
};

/** Organizer dashboard rollup across the user's events. */
export interface EventsSummary {
  totalEvents: number;
  activeEvents: number;
  archivedEvents: number;
  totalAttendees: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly authUser: AuthUserService,
  ) {}

  /** The current user's own profile, with event/registration counts. */
  async getProfile(userId: string): Promise<UserProfileWithCounts> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...PROFILE_SELECT,
        _count: { select: { events: true, registrations: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { _count, ...profile } = user;
    return {
      ...profile,
      eventCount: _count.events,
      registrationCount: _count.registrations,
    };
  }

  /** Rollup of the user's events for their dashboard. */
  async eventsSummary(userId: string): Promise<EventsSummary> {
    const [totalEvents, activeEvents, archivedEvents, totalAttendees] =
      await Promise.all([
        this.prisma.event.count({ where: { organizerId: userId } }),
        this.prisma.event.count({
          where: {
            organizerId: userId,
            isArchived: false,
            status: EventStatus.Published,
          },
        }),
        this.prisma.event.count({
          where: { organizerId: userId, isArchived: true },
        }),
        this.prisma.attendee.count({
          where: { ticket: { event: { organizerId: userId } } },
        }),
      ]);
    return { totalEvents, activeEvents, archivedEvents, totalAttendees };
  }

  /**
   * Update the current user's profile. Changing the email checks uniqueness and
   * resets `emailVerified` (re-verification required); the auth cache is evicted
   * so the next request reflects the new name/email.
   */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!current) throw new NotFoundException('User not found');

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.image !== undefined) data.image = dto.image;

    if (dto.email !== undefined && dto.email !== current.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('This email address is already in use');
      }
      data.email = dto.email;
      data.emailVerified = null;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: PROFILE_SELECT,
    });
    await this.authUser.evict(userId);
    return updated;
  }

  /**
   * Change the current user's password after verifying the current one. Accounts
   * without a password (external identities) cannot use this endpoint.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user?.password) {
      throw new BadRequestException(
        'This account has no password set and cannot change it here',
      );
    }

    const ok = await this.hashing.compare(dto.currentPassword, user.password);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const password = await this.hashing.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password },
    });
  }
}
