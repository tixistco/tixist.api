import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus } from '../events/event.constants';
import { TicketsService } from './tickets.service';

function setup() {
  const tx = {
    attendee: { create: jest.fn(), delete: jest.fn() },
    ticket: { update: jest.fn() },
  } as any;
  const prisma = {
    ticket: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  const permissions = {
    checkEventAccess: jest.fn(),
    checkModuleAccess: jest.fn(),
  } as any;
  const service = new TicketsService(prisma, permissions);
  return { service, prisma, permissions, tx };
}

const FUTURE = new Date('2999-01-01');
const LOCK = new Date('2026-01-01T00:00:00Z');

function ticketFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'tk1',
    eventId: 'e1',
    attendeeId: null,
    isCheckedIn: false,
    updatedAt: LOCK,
    registration: { userId: null },
    event: {
      id: 'e1',
      startDate: FUTURE,
      assignmentCutoffType: 'event_start',
      assignmentCutoffTime: null,
      customFields: null,
    },
    ...over,
  };
}

const assignInput = {
  attendee: { name: 'Ada', email: 'ada@example.com' },
  expectedUpdatedAt: LOCK,
};

describe('TicketsService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
  });

  describe('list', () => {
    it('scopes to the event, applies filters, derives nextCursor', async () => {
      c.prisma.ticket.findMany.mockResolvedValue([
        { id: 'tk1' },
        { id: 'tk2' },
        { id: 'tk3' },
      ]);
      const page = await c.service.list('e1', {
        limit: 2,
        ticketTypeId: 'tt1',
        isCheckedIn: false,
      });
      expect(c.prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: 'e1', ticketTypeId: 'tt1', isCheckedIn: false },
          take: 3,
        }),
      );
      expect(page.items.map((t: any) => t.id)).toEqual(['tk1', 'tk2']);
      expect(page.nextCursor).toBe('tk3');
    });

    it('omits absent filters', async () => {
      c.prisma.ticket.findMany.mockResolvedValue([]);
      await c.service.list('e1', { limit: 10 });
      expect(c.prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventId: 'e1' } }),
      );
    });
  });

  describe('getById', () => {
    it('checks event access and returns the ticket', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue({
        id: 'tk1',
        eventId: 'e1',
      });
      const ticket = await c.service.getById('u1', 'tk1');
      expect(c.permissions.checkEventAccess).toHaveBeenCalledWith('e1', 'u1');
      expect(ticket).toMatchObject({ id: 'tk1' });
    });

    it('404s when missing', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(null);
      await expect(c.service.getById('u1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getPublicByNumber', () => {
    it('returns the ticket for a published event', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue({
        id: 'tk1',
        ticketNumber: 'TKT-X-Y',
        event: { status: EventStatus.Published, isArchived: false },
      });
      await expect(
        c.service.getPublicByNumber('TKT-X-Y'),
      ).resolves.toMatchObject({ id: 'tk1' });
    });

    it('404s on an unknown number', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(null);
      await expect(c.service.getPublicByNumber('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the event is not published', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue({
        id: 'tk1',
        event: { status: EventStatus.Draft, isArchived: false },
      });
      await expect(
        c.service.getPublicByNumber('TKT-X-Y'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assign', () => {
    it('creates the attendee and links the ticket (caller is the buyer)', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({ registration: { userId: 'u1' } }),
      );
      c.tx.attendee.create.mockResolvedValue({ id: 'at1' });
      c.tx.ticket.update.mockResolvedValue({ id: 'tk1', isAssigned: true });

      await c.service.assign('u1', 'tk1', assignInput);

      expect(c.permissions.checkModuleAccess).not.toHaveBeenCalled(); // buyer path
      expect(c.tx.attendee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Ada',
            email: 'ada@example.com',
          }),
        }),
      );
      expect(c.tx.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tk1' },
          data: expect.objectContaining({
            isAssigned: true,
            attendeeId: 'at1',
          }),
        }),
      );
    });

    it('requires the TICKETS module when the caller is not the buyer', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(ticketFixture());
      c.tx.attendee.create.mockResolvedValue({ id: 'at1' });
      c.tx.ticket.update.mockResolvedValue({ id: 'tk1' });

      await c.service.assign('organizer', 'tk1', assignInput);

      expect(c.permissions.checkModuleAccess).toHaveBeenCalledWith(
        'e1',
        'organizer',
        'TICKETS',
      );
    });

    it('rejects a stale optimistic lock with 409', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(ticketFixture());
      await expect(
        c.service.assign('organizer', 'tk1', {
          ...assignInput,
          expectedUpdatedAt: new Date('2020-01-01'),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(c.tx.ticket.update).not.toHaveBeenCalled();
    });

    it('rejects once the assignment cutoff has passed', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({
          event: {
            id: 'e1',
            startDate: new Date('2000-01-01'),
            assignmentCutoffType: 'event_start',
            assignmentCutoffTime: null,
            customFields: null,
          },
        }),
      );
      await expect(
        c.service.assign('organizer', 'tk1', assignInput),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when custom-field validation fails', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({
          event: {
            id: 'e1',
            startDate: FUTURE,
            assignmentCutoffType: 'event_start',
            assignmentCutoffTime: null,
            customFields: [
              { id: 'org', label: 'Org', type: 'text', required: true },
            ],
          },
        }),
      );
      await expect(
        c.service.assign('organizer', 'tk1', assignInput),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes the previous attendee on reassignment', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({ attendeeId: 'old-at' }),
      );
      c.tx.attendee.create.mockResolvedValue({ id: 'at2' });
      c.tx.ticket.update.mockResolvedValue({ id: 'tk1' });

      await c.service.assign('organizer', 'tk1', assignInput);

      expect(c.tx.attendee.delete).toHaveBeenCalledWith({
        where: { id: 'old-at' },
      });
    });

    it('404s when the ticket is missing', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(null);
      await expect(
        c.service.assign('u1', 'nope', assignInput),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unassign', () => {
    it('clears the ticket and deletes the attendee', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({ attendeeId: 'at1', isAssigned: true }),
      );
      c.tx.ticket.update.mockResolvedValue({ id: 'tk1', isAssigned: false });

      await c.service.unassign('organizer', 'tk1', LOCK);

      expect(c.tx.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isAssigned: false, assignedAt: null, attendeeId: null },
        }),
      );
      expect(c.tx.attendee.delete).toHaveBeenCalledWith({
        where: { id: 'at1' },
      });
    });

    it('refuses to unassign a checked-in ticket', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({ attendeeId: 'at1', isCheckedIn: true }),
      );
      await expect(
        c.service.unassign('organizer', 'tk1', LOCK),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a stale optimistic lock with 409', async () => {
      c.prisma.ticket.findUnique.mockResolvedValue(
        ticketFixture({ attendeeId: 'at1' }),
      );
      await expect(
        c.service.unassign('organizer', 'tk1', new Date('2020-01-01')),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
