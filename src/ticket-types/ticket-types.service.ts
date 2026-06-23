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
    const sold = await this.soldCountsFor(tiers.map((t) => t.id));
    return tiers.map((t) => this.toAvailability(t, sold.get(t.id) ?? 0));
  }

  /** A single tier with availability; caller must be a member of its event. */
  async getById(
    callerId: string,
    id: string,
  ): Promise<TicketTypeWithAvailability> {
    const tier = await this.requireTier(id);
    await this.permissions.checkEventAccess(tier.eventId, callerId);
    return this.toAvailability(tier, await this.soldCount(tier.id));
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
      select: {
        id: true,
        status: true,
        isArchived: true,
        ticketTypes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (event?.status !== EventStatus.Published || event.isArchived) {
      throw new NotFoundException('Event not found');
    }
    const sold = await this.soldCountsFor(event.ticketTypes.map((t) => t.id));
    const now = new Date();
    return event.ticketTypes
      .map((t) => this.toAvailability(t, sold.get(t.id) ?? 0))
      .filter(
        (t) =>
          t.available > 0 &&
          (!t.saleStart || t.saleStart <= now) &&
          (!t.saleEnd || t.saleEnd >= now),
      );
  }

  // --- helpers ---

  /**
   * Sold counts for many tiers in a single query, keyed by tier id. Sold = SUM of a
   * tier's registration quantities (cancelling hard-deletes the row, freeing the slot).
   * Returns an empty map for no ids (skips the query).
   */
  private async soldCountsFor(tierIds: string[]): Promise<Map<string, number>> {
    if (tierIds.length === 0) return new Map();
    const groups = await this.prisma.registration.groupBy({
      by: ['ticketTypeId'],
      where: { ticketTypeId: { in: tierIds } },
      _sum: { quantity: true },
    });
    return new Map(groups.map((g) => [g.ticketTypeId, g._sum.quantity ?? 0]));
  }

  /** Sold count for a single tier (via the batched query). */
  private async soldCount(tierId: string): Promise<number> {
    return (await this.soldCountsFor([tierId])).get(tierId) ?? 0;
  }

  private async requireTier(id: string): Promise<TicketType> {
    const tier = await this.prisma.ticketType.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException('Ticket type not found');
    return tier;
  }

  private toAvailability(
    tier: TicketType,
    sold: number,
  ): TicketTypeWithAvailability {
    return { ...tier, sold, available: tier.quantity - sold };
  }

  private assertSaleWindow(start?: Date | null, end?: Date | null): void {
    if (start && end && start >= end) {
      throw new BadRequestException('Sale start must be before sale end');
    }
  }
}
