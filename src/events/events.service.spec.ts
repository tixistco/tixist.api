import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsService } from './events.service';

function setup() {
  const tx = {
    event: { create: jest.fn() },
    teamMember: { create: jest.fn() },
  } as any;
  const prisma = {
    event: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    registration: { count: jest.fn() },
    ticket: { count: jest.fn() },
    ticketType: { count: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  const service = new EventsService(prisma);
  return { service, prisma, tx };
}

const owner = { id: 'u1', email: 'ada@example.com', name: 'Ada' };

const baseCreate = {
  name: 'Conf 2026',
  description: 'A great conference about things',
  slug: 'conf-2026',
  locationType: 'virtual',
  locationUrl: 'https://meet.example.com/conf',
  timezone: 'Africa/Lagos',
  startDate: new Date('2026-09-01T09:00:00Z'),
  endDate: new Date('2026-09-01T17:00:00Z'),
} satisfies CreateEventDto;

describe('EventsService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
  });

  describe('create', () => {
    it('creates the event and an ACTIVE OWNER membership in one transaction', async () => {
      c.prisma.event.findUnique.mockResolvedValue(null);
      c.tx.event.create.mockResolvedValue({ id: 'e1', ...baseCreate });

      const event = await c.service.create(owner, baseCreate);

      expect(c.tx.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'conf-2026',
            organizerId: 'u1',
          }),
        }),
      );
      expect(c.tx.teamMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventId: 'e1',
            userId: 'u1',
            email: 'ada@example.com',
            role: 'OWNER',
            status: 'ACTIVE',
            invitedById: 'u1',
          }),
        }),
      );
      expect(event).toEqual({ id: 'e1', ...baseCreate });
    });

    it('rejects a slug already in use', async () => {
      c.prisma.event.findUnique.mockResolvedValue({ id: 'other' });
      await expect(c.service.create(owner, baseCreate)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(c.tx.event.create).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it('scopes to the caller and derives nextCursor from the extra row', async () => {
      c.prisma.event.findMany.mockResolvedValue([
        { id: 'e1' },
        { id: 'e2' },
        { id: 'e3' }, // the +1 sentinel
      ]);

      const page = await c.service.listMine('u1', { limit: 2 });

      expect(c.prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizerId: 'u1' }),
          take: 3,
        }),
      );
      expect(page.items.map((e: any) => e.id)).toEqual(['e1', 'e2']);
      expect(page.nextCursor).toBe('e3');
    });

    it('maps the archived filter to isArchived', async () => {
      c.prisma.event.findMany.mockResolvedValue([]);
      await c.service.listMine('u1', { limit: 10, status: 'archived' });
      expect(c.prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizerId: 'u1',
            isArchived: true,
          }),
        }),
      );
    });

    it('returns a null cursor when there is no next page', async () => {
      c.prisma.event.findMany.mockResolvedValue([{ id: 'e1' }]);
      const page = await c.service.listMine('u1', { limit: 10 });
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('statusCounts', () => {
    it('counts the caller events by status', async () => {
      c.prisma.event.count
        .mockResolvedValueOnce(3) // draft
        .mockResolvedValueOnce(2) // published
        .mockResolvedValueOnce(1); // archived

      await expect(c.service.statusCounts('u1')).resolves.toEqual({
        draft: 3,
        published: 2,
        archived: 1,
      });
    });
  });

  describe('metrics', () => {
    it('rolls up registrations, tickets, assignment and check-in', async () => {
      c.prisma.registration.count.mockResolvedValue(12);
      c.prisma.ticket.count
        .mockResolvedValueOnce(20) // total tickets
        .mockResolvedValueOnce(15) // assigned
        .mockResolvedValueOnce(9); // checked in
      c.prisma.ticketType.count.mockResolvedValue(3);

      await expect(c.service.metrics('e1')).resolves.toEqual({
        totalRegistrations: 12,
        totalTickets: 20,
        assignedTickets: 15,
        checkedInTickets: 9,
        ticketTypeCount: 3,
      });
    });
  });

  describe('findById', () => {
    it('returns the event', async () => {
      c.prisma.event.findUnique.mockResolvedValue({ id: 'e1' });
      await expect(c.service.findById('e1')).resolves.toEqual({ id: 'e1' });
    });

    it('throws NotFound when the event is missing', async () => {
      c.prisma.event.findUnique.mockResolvedValue(null);
      await expect(c.service.findById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the event', async () => {
      c.prisma.event.findUnique.mockResolvedValue({
        id: 'e1',
        slug: 'conf-2026',
      });
      c.prisma.event.update.mockResolvedValue({ id: 'e1', name: 'Renamed' });

      await c.service.update('e1', { name: 'Renamed' });

      expect(c.prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1' },
          data: { name: 'Renamed' },
        }),
      );
    });

    it('rejects a slug taken by another event', async () => {
      c.prisma.event.findUnique
        .mockResolvedValueOnce({ id: 'e1', slug: 'old' }) // findById
        .mockResolvedValueOnce({ id: 'e2' }); // slug check

      await expect(
        c.service.update('e1', { slug: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(c.prisma.event.update).not.toHaveBeenCalled();
    });
  });

  describe('archive / restore', () => {
    it('archive sets status=archived and isArchived=true', async () => {
      c.prisma.event.update.mockResolvedValue({ id: 'e1' });
      await c.service.archive('e1');
      expect(c.prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'archived', isArchived: true },
        }),
      );
    });

    it('restore sets status=draft and isArchived=false', async () => {
      c.prisma.event.update.mockResolvedValue({ id: 'e1' });
      await c.service.restore('e1');
      expect(c.prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'draft', isArchived: false },
        }),
      );
    });
  });

  describe('remove', () => {
    it('deletes the event', async () => {
      await c.service.remove('e1');
      expect(c.prisma.event.delete).toHaveBeenCalledWith({
        where: { id: 'e1' },
      });
    });
  });

  describe('public reads', () => {
    it('listPublished filters to published, non-archived', async () => {
      c.prisma.event.findMany.mockResolvedValue([]);
      await c.service.listPublished({ limit: 10 });
      expect(c.prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'published', isArchived: false },
        }),
      );
    });

    it('getPublishedBySlug returns a published event', async () => {
      const ev = {
        id: 'e1',
        slug: 'conf-2026',
        status: 'published',
        isArchived: false,
      };
      c.prisma.event.findUnique.mockResolvedValue(ev);
      await expect(c.service.getPublishedBySlug('conf-2026')).resolves.toEqual(
        ev,
      );
    });

    it('getPublishedBySlug hides a draft event behind a 404', async () => {
      c.prisma.event.findUnique.mockResolvedValue({
        id: 'e1',
        slug: 'conf-2026',
        status: 'draft',
        isArchived: false,
      });
      await expect(
        c.service.getPublishedBySlug('conf-2026'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
