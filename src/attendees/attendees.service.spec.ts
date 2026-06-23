import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { AttendeesService } from './attendees.service';

function setup() {
  const prisma = {
    attendee: { findUnique: jest.fn(), findMany: jest.fn() },
  } as any;
  const permissions = { checkEventAccess: jest.fn() } as any;
  const service = new AttendeesService(prisma, permissions);
  return { service, prisma, permissions };
}

describe('AttendeesService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
  });

  describe('list', () => {
    it('scopes to the event via the ticket, applies filters, derives nextCursor', async () => {
      c.prisma.attendee.findMany.mockResolvedValue([
        { id: 'a1' },
        { id: 'a2' },
        { id: 'a3' },
      ]);
      const page = await c.service.list('e1', {
        limit: 2,
        emailStatus: 'active',
        search: 'ada',
      });
      const arg = c.prisma.attendee.findMany.mock.calls[0][0];
      expect(arg.where.ticket).toEqual({ eventId: 'e1' });
      expect(arg.where.emailStatus).toBe('active');
      expect(arg.where.OR).toBeDefined();
      expect(arg.take).toBe(3);
      expect(page.items.map((a: any) => a.id)).toEqual(['a1', 'a2']);
      expect(page.nextCursor).toBe('a3');
    });

    it('omits absent filters', async () => {
      c.prisma.attendee.findMany.mockResolvedValue([]);
      await c.service.list('e1', { limit: 10 });
      const arg = c.prisma.attendee.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ ticket: { eventId: 'e1' } });
    });
  });

  describe('getById', () => {
    it('checks event access via the attendee ticket', async () => {
      c.prisma.attendee.findUnique.mockResolvedValue({
        id: 'a1',
        ticket: { eventId: 'e1' },
      });
      const attendee = await c.service.getById('u1', 'a1');
      expect(c.permissions.checkEventAccess).toHaveBeenCalledWith('e1', 'u1');
      expect(attendee).toMatchObject({ id: 'a1' });
    });

    it('404s when missing', async () => {
      c.prisma.attendee.findUnique.mockResolvedValue(null);
      await expect(c.service.getById('u1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the attendee has no ticket', async () => {
      c.prisma.attendee.findUnique.mockResolvedValue({
        id: 'a1',
        ticket: null,
      });
      await expect(c.service.getById('u1', 'a1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
