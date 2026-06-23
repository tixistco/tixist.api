import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service';

function setup() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    event: { count: jest.fn() },
    attendee: { count: jest.fn() },
  } as any;
  const hashing = { hash: jest.fn(), compare: jest.fn() } as any;
  const authUser = { evict: jest.fn() } as any;
  const service = new UsersService(prisma, hashing, authUser);
  return { service, prisma, hashing, authUser };
}

describe('UsersService', () => {
  let c: ReturnType<typeof setup>;
  beforeEach(() => {
    c = setup();
  });

  describe('getProfile', () => {
    it('returns the profile with flattened event/registration counts', async () => {
      c.prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: 'Ada',
        image: null,
        emailVerified: null,
        createdAt: new Date('2026-01-01'),
        _count: { events: 2, registrations: 5 },
      });

      const profile = await c.service.getProfile('u1');

      expect(profile).toMatchObject({
        id: 'u1',
        eventCount: 2,
        registrationCount: 5,
      });
      expect(profile).not.toHaveProperty('_count');
    });

    it('throws when the user no longer exists', async () => {
      c.prisma.user.findUnique.mockResolvedValue(null);
      await expect(c.service.getProfile('gone')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('eventsSummary', () => {
    it('rolls up totals/active/archived events and attendees', async () => {
      c.prisma.event.count
        .mockResolvedValueOnce(4) // total
        .mockResolvedValueOnce(2) // active (published, not archived)
        .mockResolvedValueOnce(1); // archived
      c.prisma.attendee.count.mockResolvedValue(37);

      await expect(c.service.eventsSummary('u1')).resolves.toEqual({
        totalEvents: 4,
        activeEvents: 2,
        archivedEvents: 1,
        totalAttendees: 37,
      });
    });
  });

  describe('updateProfile', () => {
    it('updates name/image and evicts the auth cache', async () => {
      c.prisma.user.findUnique.mockResolvedValue({ email: 'a@b.com' });
      c.prisma.user.update.mockResolvedValue({ id: 'u1', name: 'Ada L.' });

      await c.service.updateProfile('u1', { name: 'Ada L.' });

      expect(c.prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { name: 'Ada L.' },
        }),
      );
      expect(c.authUser.evict).toHaveBeenCalledWith('u1');
    });

    it('resets emailVerified when the email actually changes', async () => {
      c.prisma.user.findUnique
        .mockResolvedValueOnce({ email: 'old@b.com' }) // current user
        .mockResolvedValueOnce(null); // uniqueness check
      c.prisma.user.update.mockResolvedValue({ id: 'u1' });

      await c.service.updateProfile('u1', { email: 'new@b.com' });

      expect(c.prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { email: 'new@b.com', emailVerified: null },
        }),
      );
    });

    it('does not touch email/emailVerified when the email is unchanged', async () => {
      c.prisma.user.findUnique.mockResolvedValue({ email: 'a@b.com' });
      c.prisma.user.update.mockResolvedValue({ id: 'u1' });

      await c.service.updateProfile('u1', { email: 'a@b.com', name: 'Ada' });

      expect(c.prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { name: 'Ada' } }),
      );
    });

    it('rejects an email already used by another account', async () => {
      c.prisma.user.findUnique
        .mockResolvedValueOnce({ email: 'old@b.com' }) // current user
        .mockResolvedValueOnce({ id: 'someone-else' }); // uniqueness check

      await expect(
        c.service.updateProfile('u1', { email: 'taken@b.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(c.prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws when the user no longer exists', async () => {
      c.prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        c.service.updateProfile('gone', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changePassword', () => {
    it('verifies the current password and stores the new hash', async () => {
      c.prisma.user.findUnique.mockResolvedValue({ password: 'old-hash' });
      c.hashing.compare.mockResolvedValue(true);
      c.hashing.hash.mockResolvedValue('new-hash');

      await c.service.changePassword('u1', {
        currentPassword: 'old-pw',
        newPassword: 'new-pw-1',
      });

      expect(c.hashing.compare).toHaveBeenCalledWith('old-pw', 'old-hash');
      expect(c.hashing.hash).toHaveBeenCalledWith('new-pw-1');
      expect(c.prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { password: 'new-hash' },
      });
    });

    it('rejects an incorrect current password', async () => {
      c.prisma.user.findUnique.mockResolvedValue({ password: 'old-hash' });
      c.hashing.compare.mockResolvedValue(false);

      await expect(
        c.service.changePassword('u1', {
          currentPassword: 'wrong',
          newPassword: 'new-pw-1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(c.prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects accounts without a password set', async () => {
      c.prisma.user.findUnique.mockResolvedValue({ password: null });

      await expect(
        c.service.changePassword('u1', {
          currentPassword: 'x',
          newPassword: 'new-pw-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
