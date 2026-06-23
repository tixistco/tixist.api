import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Event, Prisma, TeamMemberStatus, TeamRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { Paginated } from '../common/pagination/paginated';
import { PrismaService } from '../prisma/prisma.service';
import { EventStatus } from './event.constants';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

interface ListMineParams {
  limit: number;
  cursor?: string;
  status?: EventStatus;
}

interface ListPublishedParams {
  limit: number;
  cursor?: string;
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create an event owned by the caller. Slug must be globally unique. The event
   * and the owner's `ACTIVE`/`OWNER` `TeamMember` are written in one transaction so
   * the RBAC guards recognize the creator immediately.
   */
  async create(owner: AuthUser, dto: CreateEventDto): Promise<Event> {
    await this.assertSlugFree(dto.slug);
    const { customFields, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          ...rest,
          customFields: this.toJson(customFields),
          organizerId: owner.id,
        },
      });
      await tx.teamMember.create({
        data: {
          eventId: event.id,
          userId: owner.id,
          email: owner.email ?? '',
          role: TeamRole.OWNER,
          status: TeamMemberStatus.ACTIVE,
          invitedById: owner.id,
        },
      });
      return event;
    });
  }

  /** The caller's own events, newest first, cursor-paginated. */
  async listMine(
    userId: string,
    params: ListMineParams,
  ): Promise<Paginated<Event>> {
    const { limit, cursor, status } = params;
    const where: Prisma.EventWhereInput = { organizerId: userId };
    if (status === EventStatus.Archived) {
      where.isArchived = true;
    } else if (status) {
      where.status = status;
    }
    return this.page(where, limit, cursor);
  }

  /** Counts of the caller's events grouped by status. */
  async statusCounts(
    userId: string,
  ): Promise<{ draft: number; published: number; archived: number }> {
    const [draft, published, archived] = await Promise.all([
      this.prisma.event.count({
        where: { organizerId: userId, status: EventStatus.Draft },
      }),
      this.prisma.event.count({
        where: { organizerId: userId, status: EventStatus.Published },
      }),
      this.prisma.event.count({
        where: { organizerId: userId, status: EventStatus.Archived },
      }),
    ]);
    return { draft, published, archived };
  }

  /**
   * Load an event by id, or 404. Authorization (membership/ownership) is enforced
   * by the route's RBAC guard before this runs.
   */
  async findById(id: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async update(id: string, dto: UpdateEventDto): Promise<Event> {
    const current = await this.findById(id);
    if (dto.slug && dto.slug !== current.slug) {
      await this.assertSlugFree(dto.slug);
    }
    const { customFields, ...rest } = dto;
    return this.prisma.event.update({
      where: { id },
      data: {
        ...rest,
        ...(customFields !== undefined && {
          customFields: this.toJson(customFields),
        }),
      },
    });
  }

  /** Soft-archive (hides from the public surface; reversible via restore). */
  archive(id: string): Promise<Event> {
    return this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.Archived, isArchived: true },
    });
  }

  /** Restore an archived event back to draft for review. */
  restore(id: string): Promise<Event> {
    return this.prisma.event.update({
      where: { id },
      data: { status: EventStatus.Draft, isArchived: false },
    });
  }

  /** Permanently delete an event (cascades to its children). */
  async remove(id: string): Promise<void> {
    await this.prisma.event.delete({ where: { id } });
  }

  // --- public surface ---

  /** Published, non-archived events for public discovery. */
  listPublished(params: ListPublishedParams): Promise<Paginated<Event>> {
    return this.page(
      { status: EventStatus.Published, isArchived: false },
      params.limit,
      params.cursor,
    );
  }

  /** A single published event by slug; drafts/archived are hidden behind a 404. */
  async getPublishedBySlug(slug: string): Promise<Event> {
    const event = await this.prisma.event.findUnique({ where: { slug } });
    if (event?.status !== EventStatus.Published || event.isArchived) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  // --- helpers ---

  private async assertSlugFree(slug: string): Promise<void> {
    const existing = await this.prisma.event.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException('An event with this slug already exists');
    }
  }

  private async page(
    where: Prisma.EventWhereInput,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<Event>> {
    const rows = await this.prisma.event.findMany({
      where,
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { startDate: 'desc' },
    });
    const nextCursor = rows.length > limit ? (rows.pop()?.id ?? null) : null;
    return new Paginated(rows, nextCursor);
  }

  private toJson(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value;
  }
}
