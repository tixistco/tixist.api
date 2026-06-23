import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Ticket } from '@prisma/client';
import { Paginated } from '../common/pagination/paginated';
import { isAssignmentClosed } from '../events/assignment-cutoff';
import {
  parseFieldDefinitions,
  validateCustomData,
} from '../events/custom-fields';
import { EventStatus } from '../events/event.constants';
import { PermissionsService } from '../permissions/permissions.service';
import { Module } from '../permissions/permissions.types';
import { PrismaService } from '../prisma/prisma.service';

interface ListParams {
  limit: number;
  cursor?: string;
  ticketTypeId?: string;
  isCheckedIn?: boolean;
  isAssigned?: boolean;
}

interface AssignInput {
  attendee: {
    name: string;
    email: string;
    customData?: Record<string, unknown>;
  };
  expectedUpdatedAt: Date;
}

/** A ticket as returned by the public number-lookup, with light event context. */
const PUBLIC_SELECT = {
  id: true,
  ticketNumber: true,
  qrCodeData: true,
  isAssigned: true,
  isCheckedIn: true,
  checkedInAt: true,
  ticketType: { select: { name: true } },
  event: {
    select: {
      name: true,
      slug: true,
      startDate: true,
      status: true,
      isArchived: true,
    },
  },
} satisfies Prisma.TicketSelect;

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Tickets for an event (organizer/team; ATTENDEES module), newest first. */
  async list(eventId: string, params: ListParams): Promise<Paginated<Ticket>> {
    const { limit, cursor, ticketTypeId, isCheckedIn, isAssigned } = params;
    const where: Prisma.TicketWhereInput = {
      eventId,
      ...(ticketTypeId && { ticketTypeId }),
      ...(isCheckedIn !== undefined && { isCheckedIn }),
      ...(isAssigned !== undefined && { isAssigned }),
    };
    const rows = await this.prisma.ticket.findMany({
      where,
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { createdAt: 'desc' },
    });
    const nextCursor = rows.length > limit ? (rows.pop()?.id ?? null) : null;
    return new Paginated(rows, nextCursor);
  }

  /** A single ticket; caller must be a member of its event. */
  async getById(callerId: string, id: string): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ticketType: { select: { name: true } },
        registration: { select: { email: true, name: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    await this.permissions.checkEventAccess(ticket.eventId, callerId);
    return ticket;
  }

  /**
   * Public lookup by ticket number (attendee self-service). Returns light event
   * context; hidden behind a 404 unless the event is published.
   */
  async getPublicByNumber(ticketNumber: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { ticketNumber },
      select: PUBLIC_SELECT,
    });
    if (
      !ticket ||
      ticket.event.status !== EventStatus.Published ||
      ticket.event.isArchived
    ) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  /**
   * Assign a ticket to an attendee. Allowed for the registration's buyer or a holder
   * of the TICKETS module. Cutoff-gated, optimistic-locked on `expectedUpdatedAt`, and
   * validates `customData` against the event's custom fields. Reassignment replaces the
   * previous attendee.
   */
  async assign(
    callerId: string,
    ticketId: string,
    input: AssignInput,
  ): Promise<Ticket> {
    const ticket = await this.loadForAssignment(ticketId);
    await this.assertCanAssign(
      ticket.registration.userId,
      ticket.eventId,
      callerId,
    );
    this.assertCutoffOpen(ticket.event);
    this.assertFresh(ticket.updatedAt, input.expectedUpdatedAt);

    const errors = validateCustomData(
      parseFieldDefinitions(ticket.event.customFields),
      input.attendee.customData,
    );
    if (errors.length) {
      throw new BadRequestException(
        `Custom field validation failed: ${errors.join(', ')}`,
      );
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (ticket.attendeeId) {
        await tx.attendee.delete({ where: { id: ticket.attendeeId } });
      }
      const attendee = await tx.attendee.create({
        data: {
          name: input.attendee.name,
          email: input.attendee.email,
          customData: this.toJson(input.attendee.customData),
        },
      });
      return tx.ticket.update({
        where: { id: ticketId },
        data: { isAssigned: true, assignedAt: now, attendeeId: attendee.id },
        include: { attendee: true, ticketType: { select: { name: true } } },
      });
    });
  }

  /**
   * Unassign a ticket and delete its attendee. Blocked once checked in; cutoff-gated
   * and optimistic-locked.
   */
  async unassign(
    callerId: string,
    ticketId: string,
    expectedUpdatedAt: Date,
  ): Promise<Ticket> {
    const ticket = await this.loadForAssignment(ticketId);
    await this.assertCanAssign(
      ticket.registration.userId,
      ticket.eventId,
      callerId,
    );
    if (ticket.isCheckedIn) {
      throw new BadRequestException('Cannot unassign a checked-in ticket');
    }
    this.assertCutoffOpen(ticket.event);
    this.assertFresh(ticket.updatedAt, expectedUpdatedAt);
    if (!ticket.attendeeId) {
      throw new BadRequestException('Ticket is not assigned');
    }

    const attendeeId = ticket.attendeeId;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: { isAssigned: false, assignedAt: null, attendeeId: null },
      });
      await tx.attendee.delete({ where: { id: attendeeId } });
      return updated;
    });
  }

  // --- helpers ---

  private loadForAssignment(ticketId: string) {
    return this.prisma.ticket
      .findUnique({
        where: { id: ticketId },
        include: {
          registration: { select: { userId: true } },
          event: {
            select: {
              id: true,
              startDate: true,
              assignmentCutoffType: true,
              assignmentCutoffTime: true,
              customFields: true,
            },
          },
        },
      })
      .then((ticket) => {
        if (!ticket) throw new NotFoundException('Ticket not found');
        return ticket;
      });
  }

  /** The buyer of the registration may (un)assign; otherwise the TICKETS module is required. */
  private async assertCanAssign(
    buyerUserId: string | null,
    eventId: string,
    callerId: string,
  ): Promise<void> {
    if (buyerUserId && buyerUserId === callerId) return;
    await this.permissions.checkModuleAccess(eventId, callerId, Module.Tickets);
  }

  private assertCutoffOpen(event: {
    assignmentCutoffType: string;
    assignmentCutoffTime: Date | null;
    startDate: Date;
  }): void {
    if (isAssignmentClosed(event)) {
      throw new BadRequestException('Assignment cutoff time has passed');
    }
  }

  private assertFresh(actual: Date, expected: Date): void {
    if (actual.getTime() !== expected.getTime()) {
      throw new ConflictException(
        'Ticket was modified by someone else. Refresh and try again.',
      );
    }
  }

  private toJson(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value;
  }
}
