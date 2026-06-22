import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TeamService } from './team.service';

function setup() {
  const tx = {
    invitation: { create: jest.fn(), update: jest.fn() },
    teamMember: {
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const prisma = {
    teamMember: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    invitation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  const permissions = { checkIsOwner: jest.fn() } as any;
  const service = new TeamService(prisma, permissions);
  return { service, prisma, permissions, tx };
}

const inviter = { id: 'owner1', email: 'owner@example.com', name: 'Owner' };

describe('TeamService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
  });

  describe('invite', () => {
    const dto = {
      email: 'New@Example.com',
      modulePermissions: ['CFP'] as const,
    };

    it('rejects inviting yourself', async () => {
      await expect(
        c.service.invite('e1', inviter, {
          email: 'owner@example.com',
          modulePermissions: ['CFP'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an already-active member', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      await expect(c.service.invite('e1', inviter, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when a pending invitation already exists', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue(null);
      c.prisma.invitation.findFirst.mockResolvedValue({ id: 'inv0' });
      await expect(c.service.invite('e1', inviter, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates an invitation + pending member (email normalized)', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue(null);
      c.prisma.invitation.findFirst.mockResolvedValue(null);
      c.tx.invitation.create.mockResolvedValue({ id: 'inv1', token: 'tok' });
      c.tx.teamMember.upsert.mockResolvedValue({ id: 'm1', status: 'PENDING' });

      await c.service.invite('e1', inviter, dto);

      expect(c.tx.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventId: 'e1',
            email: 'new@example.com',
            modulePermissions: ['CFP'],
            sentById: 'owner1',
          }),
        }),
      );
      expect(c.tx.teamMember.upsert).toHaveBeenCalled();
    });
  });

  describe('acceptInvitation', () => {
    const accepter = { id: 'u2', email: 'new@example.com', name: 'New' };

    it('404s on an unknown token', async () => {
      c.prisma.invitation.findUnique.mockResolvedValue(null);
      await expect(
        c.service.acceptInvitation(accepter, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a non-pending invitation', async () => {
      c.prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv1',
        status: 'ACCEPTED',
        expiresAt: new Date('2999-01-01'),
      });
      await expect(
        c.service.acceptInvitation(accepter, 'tok'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired invitation', async () => {
      c.prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv1',
        status: 'PENDING',
        expiresAt: new Date('2000-01-01'),
      });
      await expect(
        c.service.acceptInvitation(accepter, 'tok'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activates the membership and links the user', async () => {
      c.prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv1',
        eventId: 'e1',
        email: 'new@example.com',
        status: 'PENDING',
        expiresAt: new Date('2999-01-01'),
      });
      c.prisma.teamMember.findFirst.mockResolvedValue(null); // no existing active
      c.tx.teamMember.findUnique.mockResolvedValue({ id: 'm1' });
      c.tx.teamMember.update.mockResolvedValue({ id: 'm1', status: 'ACTIVE' });

      await c.service.acceptInvitation(accepter, 'tok');

      expect(c.tx.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACCEPTED' }),
        }),
      );
      expect(c.tx.teamMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE', userId: 'u2' }),
        }),
      );
    });
  });

  describe('declineInvitation', () => {
    it('marks declined and removes the pending member', async () => {
      c.prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv1',
        eventId: 'e1',
        email: 'new@example.com',
        status: 'PENDING',
        expiresAt: new Date('2999-01-01'),
      });

      await c.service.declineInvitation('tok');

      expect(c.tx.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DECLINED' }),
        }),
      );
      expect(c.tx.teamMember.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: 'e1', email: 'new@example.com', status: 'PENDING' },
        }),
      );
    });
  });

  describe('updatePermissions', () => {
    it('rejects modifying an owner', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1',
        eventId: 'e1',
        role: 'OWNER',
        status: 'ACTIVE',
      });
      await expect(
        c.service.updatePermissions('owner1', 'm1', ['CFP']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(c.permissions.checkIsOwner).toHaveBeenCalledWith('e1', 'owner1');
    });

    it('rejects an inactive member', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1',
        eventId: 'e1',
        role: 'COLLABORATOR',
        status: 'PENDING',
      });
      await expect(
        c.service.updatePermissions('owner1', 'm1', ['CFP']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates an active collaborator', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1',
        eventId: 'e1',
        role: 'COLLABORATOR',
        status: 'ACTIVE',
      });
      c.prisma.teamMember.update = jest.fn().mockResolvedValue({ id: 'm1' });
      await c.service.updatePermissions('owner1', 'm1', ['CFP', 'ATTENDEES']);
      expect(c.prisma.teamMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { modulePermissions: ['CFP', 'ATTENDEES'] },
        }),
      );
    });
  });

  describe('removeMember', () => {
    it('rejects removing an owner', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1',
        eventId: 'e1',
        role: 'OWNER',
        status: 'ACTIVE',
      });
      await expect(
        c.service.removeMember('owner1', 'm1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets a collaborator to REMOVED', async () => {
      c.prisma.teamMember.findUnique.mockResolvedValue({
        id: 'm1',
        eventId: 'e1',
        role: 'COLLABORATOR',
        status: 'ACTIVE',
      });
      c.prisma.teamMember.update = jest.fn().mockResolvedValue({ id: 'm1' });
      await c.service.removeMember('owner1', 'm1');
      expect(c.permissions.checkIsOwner).toHaveBeenCalledWith('e1', 'owner1');
      expect(c.prisma.teamMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'm1' },
          data: { status: 'REMOVED' },
        }),
      );
    });
  });

  describe('cancelInvitation', () => {
    it('cancels a pending invitation and removes the pending member', async () => {
      c.prisma.invitation.findUnique.mockResolvedValue({
        id: 'inv1',
        eventId: 'e1',
        email: 'new@example.com',
        status: 'PENDING',
      });
      await c.service.cancelInvitation('owner1', 'inv1');
      expect(c.permissions.checkIsOwner).toHaveBeenCalledWith('e1', 'owner1');
      expect(c.tx.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(c.tx.teamMember.deleteMany).toHaveBeenCalled();
    });
  });
});
