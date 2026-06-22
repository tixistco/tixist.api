import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Registration } from '@prisma/client';
import { Paginated } from '../common/pagination/paginated';
import { EventStatus } from '../events/event.constants';
import { PermissionsService } from '../permissions/permissions.service';
import { Module } from '../permissions/permissions.types';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentStatus } from './registration.constants';
import { RegisterDto } from './dto/register.dto';

/** Row shape from the FOR UPDATE lock query. */
interface LockedTier {
  id: string;
  eventId: string;
  price: bigint;
  quantity: number;
  saleStart: Date | null;
  saleEnd: Date | null;
}

interface ListParams {
  limit: number;
  cursor?: string;
  ticketTypeId?: string;
}

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Concurrency-safe self-registration. Locks the tier row `FOR UPDATE` so
   * concurrent registrations for the same tier serialize and capacity can't be
   * oversold. Only **free** tiers of a **published** event are registrable until
   * the payment processor lands.
   */
  async register(dto: RegisterDto, userId?: string): Promise<Registration> {
    const quantity = dto.quantity ?? 1;

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the tier row (no aggregate here — Postgres forbids FOR UPDATE + GROUP BY).
      const rows = await tx.$queryRaw<LockedTier[]>`
        SELECT id, "eventId", price, quantity, "saleStart", "saleEnd"
        FROM "TicketType"
        WHERE id = ${dto.ticketTypeId}
        FOR UPDATE
      `;
      const tier = rows[0];
      if (!tier) throw new NotFoundException('Ticket type not found');

      // 2. Event must be published and live.
      const event = await tx.event.findUnique({
        where: { id: tier.eventId },
        select: {
          id: true,
          status: true,
          isArchived: true,
          maxTicketsPerPurchase: true,
        },
      });
      if (
        !event ||
        event.status !== EventStatus.Published ||
        event.isArchived
      ) {
        throw new NotFoundException('Event not found');
      }

      // 3. Only free tiers are registrable for now.
      if (tier.price !== BigInt(0)) {
        throw new BadRequestException(
          'Paid registration is not available yet for this ticket type',
        );
      }

      // 4. Sale window.
      const now = new Date();
      if (tier.saleStart && tier.saleStart > now) {
        throw new BadRequestException('Ticket sales have not started yet');
      }
      if (tier.saleEnd && tier.saleEnd < now) {
        throw new BadRequestException('Ticket sales have ended');
      }

      // 5. Quantity bounds.
      if (quantity < 1) {
        throw new BadRequestException('Quantity must be at least 1');
      }
      if (quantity > event.maxTicketsPerPurchase) {
        throw new BadRequestException(
          `At most ${event.maxTicketsPerPurchase} ticket(s) per registration`,
        );
      }

      // 6. Capacity (consistent under the lock).
      const { _sum } = await tx.registration.aggregate({
        where: { ticketTypeId: tier.id },
        _sum: { quantity: true },
      });
      const available = tier.quantity - (_sum.quantity ?? 0);
      if (quantity > available) {
        throw new BadRequestException(
          available <= 0
            ? 'This ticket type is sold out'
            : `Only ${available} ticket(s) remaining`,
        );
      }

      // 7. Record the registration (atomic with the lock).
      return tx.registration.create({
        data: {
          eventId: tier.eventId,
          ticketTypeId: tier.id,
          email: dto.email,
          name: dto.name,
          userId,
          quantity,
          paymentStatus: PaymentStatus.Free,
        },
      });
    });
  }

  /** Registrations for an event (organizer/team; ATTENDEES module), newest first. */
  async list(
    eventId: string,
    params: ListParams,
  ): Promise<Paginated<Registration>> {
    const { limit, cursor, ticketTypeId } = params;
    const where: Prisma.RegistrationWhereInput = {
      eventId,
      ...(ticketTypeId && { ticketTypeId }),
    };
    const rows = await this.prisma.registration.findMany({
      where,
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      orderBy: { registeredAt: 'desc' },
    });
    const nextCursor = rows.length > limit ? (rows.pop()?.id ?? null) : null;
    return new Paginated(rows, nextCursor);
  }

  /** A single registration; caller must be a member of its event. */
  async getById(callerId: string, id: string): Promise<Registration> {
    const registration = await this.requireRegistration(id);
    await this.permissions.checkEventAccess(registration.eventId, callerId);
    return registration;
  }

  /**
   * Cancel a registration by hard-deleting it, which frees the ticket slot
   * (inventory is the SUM of remaining registration quantities). ATTENDEES module.
   */
  async cancel(callerId: string, id: string): Promise<void> {
    const registration = await this.requireRegistration(id);
    await this.permissions.checkModuleAccess(
      registration.eventId,
      callerId,
      Module.Attendees,
    );
    await this.prisma.registration.delete({ where: { id } });
  }

  private async requireRegistration(id: string): Promise<Registration> {
    const registration = await this.prisma.registration.findUnique({
      where: { id },
    });
    if (!registration) throw new NotFoundException('Registration not found');
    return registration;
  }
}
