import { Injectable, NotFoundException } from '@nestjs/common';
import { Attendee, Prisma } from '@prisma/client';
import { Paginated } from '../common/pagination/paginated';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailStatus } from './attendee.constants';

interface ListParams {
  limit: number;
  cursor?: string;
  emailStatus?: EmailStatus;
  search?: string;
}

/** Include the linked ticket (light) so callers can show check-in/ticket context. */
const WITH_TICKET = {
  ticket: {
    select: { id: true, eventId: true, ticketNumber: true, isCheckedIn: true },
  },
} satisfies Prisma.AttendeeInclude;

@Injectable()
export class AttendeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Attendees of an event (scoped through their 1:1 ticket), newest first. Optionally
   * filter by email status and a name/email search.
   */
  async list(
    eventId: string,
    params: ListParams,
  ): Promise<Paginated<Attendee>> {
    const { limit, cursor, emailStatus, search } = params;
    const where: Prisma.AttendeeWhereInput = {
      ticket: { eventId },
      ...(emailStatus && { emailStatus }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const rows = await this.prisma.attendee.findMany({
      where,
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
      include: WITH_TICKET,
    });
    const nextCursor = rows.length > limit ? (rows.pop()?.id ?? null) : null;
    return new Paginated(rows, nextCursor);
  }

  /** A single attendee; caller must be a member of the attendee's event. */
  async getById(callerId: string, id: string): Promise<Attendee> {
    const attendee = await this.prisma.attendee.findUnique({
      where: { id },
      include: WITH_TICKET,
    });
    if (!attendee?.ticket) throw new NotFoundException('Attendee not found');
    await this.permissions.checkEventAccess(attendee.ticket.eventId, callerId);
    return attendee;
  }
}
