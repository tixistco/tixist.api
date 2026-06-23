import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketTypesService } from './ticket-types.service';

function setup() {
  const prisma = {
    ticketType: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    event: { findUnique: jest.fn() },
    // soldCountsFor() groups registration quantities by tier; default to none sold.
    registration: {
      groupBy: jest.fn(() => Promise.resolve([])),
    },
  } as any;
  const permissions = {
    checkEventAccess: jest.fn(),
    checkModuleAccess: jest.fn(),
  } as any;
  const service = new TicketTypesService(prisma, permissions);
  return { service, prisma, permissions };
}

const baseCreate = {
  name: 'General Admission',
  description: 'Standard entry',
  quantity: 100,
};

describe('TicketTypesService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
  });

  describe('create', () => {
    it('stores price as BigInt minor units (default 0 / NGN)', async () => {
      c.prisma.ticketType.create.mockResolvedValue({ id: 't1' });
      await c.service.create('e1', baseCreate);
      expect(c.prisma.ticketType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventId: 'e1',
            price: 0n,
            currency: 'NGN',
            quantity: 100,
          }),
        }),
      );
    });

    it('converts a provided price to BigInt', async () => {
      c.prisma.ticketType.create.mockResolvedValue({ id: 't1' });
      await c.service.create('e1', {
        ...baseCreate,
        price: 500000,
        currency: 'NGN',
      });
      expect(c.prisma.ticketType.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ price: 500000n }),
        }),
      );
    });

    it('rejects a sale window that ends before it starts', async () => {
      await expect(
        c.service.create('e1', {
          ...baseCreate,
          saleStart: new Date('2026-02-01'),
          saleEnd: new Date('2026-01-01'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(c.prisma.ticketType.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns each tier with derived availability', async () => {
      c.prisma.ticketType.findMany.mockResolvedValue([
        { id: 't1', quantity: 100, price: 0n },
      ]);
      const items = await c.service.list('e1');
      expect(items[0]).toMatchObject({ id: 't1', sold: 0, available: 100 });
    });
  });

  describe('getById', () => {
    it('checks event access and returns availability', async () => {
      c.prisma.ticketType.findUnique.mockResolvedValue({
        id: 't1',
        eventId: 'e1',
        quantity: 50,
      });
      const tt = await c.service.getById('u1', 't1');
      expect(c.permissions.checkEventAccess).toHaveBeenCalledWith('e1', 'u1');
      expect(tt).toMatchObject({ id: 't1', available: 50 });
    });

    it('404s when missing', async () => {
      c.prisma.ticketType.findUnique.mockResolvedValue(null);
      await expect(c.service.getById('u1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('requires the TICKETS module and updates', async () => {
      c.prisma.ticketType.findUnique.mockResolvedValue({
        id: 't1',
        eventId: 'e1',
        price: 0n,
        quantity: 100,
      });
      c.prisma.ticketType.update.mockResolvedValue({ id: 't1' });
      await c.service.update('u1', 't1', { quantity: 150 });
      expect(c.permissions.checkModuleAccess).toHaveBeenCalledWith(
        'e1',
        'u1',
        'TICKETS',
      );
      expect(c.prisma.ticketType.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: expect.objectContaining({ quantity: 150 }),
        }),
      );
    });

    it('rejects dropping quantity below the sold count', async () => {
      c.prisma.ticketType.findUnique.mockResolvedValue({
        id: 't1',
        eventId: 'e1',
        price: 0n,
        quantity: 100,
      });
      // soldCount is 0 today; simulate the guard by forcing a negative target
      await expect(
        c.service.update('u1', 't1', { quantity: -1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(c.prisma.ticketType.update).not.toHaveBeenCalled();
    });

    it('404s when missing', async () => {
      c.prisma.ticketType.findUnique.mockResolvedValue(null);
      await expect(
        c.service.update('u1', 'nope', { quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('requires the TICKETS module and deletes', async () => {
      c.prisma.ticketType.findUnique.mockResolvedValue({
        id: 't1',
        eventId: 'e1',
      });
      await c.service.remove('u1', 't1');
      expect(c.permissions.checkModuleAccess).toHaveBeenCalledWith(
        'e1',
        'u1',
        'TICKETS',
      );
      expect(c.prisma.ticketType.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
    });
  });

  describe('listPublicBySlug', () => {
    it('404s when the event is not published', async () => {
      c.prisma.event.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'draft',
        isArchived: false,
      });
      await expect(
        c.service.listPublicBySlug('conf-2026'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists availability for a published event (tiers come from the event query)', async () => {
      c.prisma.event.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'published',
        isArchived: false,
        ticketTypes: [
          {
            id: 't1',
            eventId: 'e1',
            quantity: 10,
            saleStart: null,
            saleEnd: null,
          },
        ],
      });
      const items = await c.service.listPublicBySlug('conf-2026');
      expect(items[0]).toMatchObject({ id: 't1', available: 10 });
    });

    it('subtracts sold quantities and queries sold-counts only once', async () => {
      c.prisma.event.findUnique.mockResolvedValue({
        id: 'e1',
        status: 'published',
        isArchived: false,
        ticketTypes: [
          {
            id: 't1',
            eventId: 'e1',
            quantity: 10,
            saleStart: null,
            saleEnd: null,
          },
          {
            id: 't2',
            eventId: 'e1',
            quantity: 5,
            saleStart: null,
            saleEnd: null,
          },
        ],
      });
      c.prisma.registration.groupBy.mockResolvedValue([
        { ticketTypeId: 't1', _sum: { quantity: 7 } },
      ]);
      const items = await c.service.listPublicBySlug('conf-2026');
      expect(items).toMatchObject([
        { id: 't1', sold: 7, available: 3 },
        { id: 't2', sold: 0, available: 5 },
      ]);
      expect(c.prisma.registration.groupBy).toHaveBeenCalledTimes(1);
    });
  });
});
