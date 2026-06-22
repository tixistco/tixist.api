import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TicketType } from '@prisma/client';
import { EventStatus } from '../events/event.constants';
import { PermissionsService } from '../permissions/permissions.service';
import { Module } from '../permissions/permissions.types';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_CURRENCY } from './ticket-type.constants';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';

/** A ticket tier plus its derived inventory. */
export type TicketTypeWithAvailability = TicketType & {
  sold: number;
  available: number;
};

@Injectable()
export class TicketTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Create a tier for an event (route-gated by the TICKETS module). Price is taken
   * in minor units and stored as BigInt; currency defaults to NGN.
   */
  async create(eventId: string, dto: CreateTicketTypeDto): Promise<TicketType> {
    this.assertSaleWindow(dto.saleStart, dto.saleEnd);
    return this.prisma.ticketType.create({
      data: {
        eventId,
        name: dto.name,
        description: dto.description,
        price: BigInt(dto.price ?? 0),
        currency: dto.currency ?? DEFAULT_CURRENCY,
        quantity: dto.quantity,
        saleStart: dto.saleStart,
        saleEnd: dto.saleEnd,
      },
    });
  }

  /** All tiers for an event, each with derived availability. */
  async list(eventId: string): Promise<TicketTypeWithAvailability[]> {
    const tiers = await this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(tiers.map((t) => this.withAvailability(t)));
  }

  /** A single tier with availability; caller must be a member of its event. */
  async getById(
    callerId: string,
    id: string,
  ): Promise<TicketTypeWithAvailability> {
    const tier = await this.requireTier(id);
    await this.permissions.checkEventAccess(tier.eventId, callerId);
    return this.withAvailability(tier);
  }

  /** Update a tier (TICKETS module). Inventory/price guards key off the sold count. */
  async update(
    callerId: string,
    id: string,
    dto: UpdateTicketTypeDto,
  ): Promise<TicketType> {
    const tier = await this.requireTier(id);
    await this.permissions.checkModuleAccess(
      tier.eventId,
      callerId,
      Module.Tickets,
    );

    const sold = await this.soldCount(tier.id);
    if (dto.quantity !== undefined && dto.quantity < sold) {
      throw new BadRequestException(
        `Cannot decrease quantity below the sold count (${sold})`,
      );
    }
    if (
      dto.price !== undefined &&
      sold > 0 &&
      BigInt(dto.price) !== tier.price
    ) {
      throw new BadRequestException(
        'Cannot change price after tickets have been sold',
      );
    }
    this.assertSaleWindow(
      dto.saleStart ?? tier.saleStart,
      dto.saleEnd ?? tier.saleEnd,
    );

    return this.prisma.ticketType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: BigInt(dto.price) }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.saleStart !== undefined && { saleStart: dto.saleStart }),
        ...(dto.saleEnd !== undefined && { saleEnd: dto.saleEnd }),
      },
    });
  }

  /** Delete a tier (TICKETS module); blocked once it has registrations. */
  async remove(callerId: string, id: string): Promise<void> {
    const tier = await this.requireTier(id);
    await this.permissions.checkModuleAccess(
      tier.eventId,
      callerId,
      Module.Tickets,
    );

    const sold = await this.soldCount(tier.id);
    if (sold > 0) {
      throw new BadRequestException(
        `Cannot delete a tier with ${sold} registration(s). End its sale window instead.`,
      );
    }
    await this.prisma.ticketType.delete({ where: { id } });
  }

  /** Public registration view: in-sale, available tiers of a published event. */
  async listPublicBySlug(slug: string): Promise<TicketTypeWithAvailability[]> {
    const event = await this.prisma.event.findUnique({
      where: { slug },
      select: { id: true, status: true, isArchived: true },
    });
    if (!event || event.status !== EventStatus.Published || event.isArchived) {
      throw new NotFoundException('Event not found');
    }
    const now = new Date();
    const tiers = await this.prisma.ticketType.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
    });
    const withAvailability = await Promise.all(
      tiers.map((t) => this.withAvailability(t)),
    );
    return withAvailability.filter(
      (t) =>
        t.available > 0 &&
        (!t.saleStart || t.saleStart <= now) &&
        (!t.saleEnd || t.saleEnd >= now),
    );
  }

  // --- helpers ---

  /**
   * Sold count for a tier = SUM of its registration quantities (cancelling a
   * registration hard-deletes the row, freeing the slot).
   */
  private async soldCount(tierId: string): Promise<number> {
    const { _sum } = await this.prisma.registration.aggregate({
      where: { ticketTypeId: tierId },
      _sum: { quantity: true },
    });
    return _sum.quantity ?? 0;
  }

  private async requireTier(id: string): Promise<TicketType> {
    const tier = await this.prisma.ticketType.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException('Ticket type not found');
    return tier;
  }

  private async withAvailability(
    tier: TicketType,
  ): Promise<TicketTypeWithAvailability> {
    const sold = await this.soldCount(tier.id);
    return { ...tier, sold, available: tier.quantity - sold };
  }

  private assertSaleWindow(start?: Date | null, end?: Date | null): void {
    if (start && end && start >= end) {
      throw new BadRequestException('Sale start must be before sale end');
    }
  }
}
