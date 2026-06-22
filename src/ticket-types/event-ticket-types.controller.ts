import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { TicketType } from '@prisma/client';
import {
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { ApiTag } from '../openapi/api-tags';
import {
  EventAccessGuard,
  ModuleGuard,
} from '../permissions/event-rbac.guards';
import { Module } from '../permissions/permissions.types';
import { RequireModule } from '../permissions/require-module.decorator';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { TicketTypeResponseDto } from './dto/ticket-type-response.dto';
import {
  TicketTypesService,
  type TicketTypeWithAvailability,
} from './ticket-types.service';

/** Ticket tiers scoped to one event (`/events/{eventId}/ticket-types`). */
@ApiTags(ApiTag.TicketTypes)
@ApiBearerAuth()
@Controller('events/:eventId/ticket-types')
export class EventTicketTypesController {
  constructor(private readonly ticketTypes: TicketTypesService) {}

  /**
   * Create a ticket tier.
   * @remarks Requires the TICKETS module. Price is in minor units (defaults to 0/NGN).
   */
  @Post()
  @UseGuards(ModuleGuard)
  @RequireModule(Module.Tickets)
  @HttpCode(201)
  @ApiStandardResponse(TicketTypeResponseDto, {
    status: 201,
    description: 'Created',
  })
  @ApiProblemResponse(403, 'Missing TICKETS access')
  @ApiProblemResponse(400, 'Invalid sale window or payload')
  create(
    @Param('eventId') eventId: string,
    @Body() dto: CreateTicketTypeDto,
  ): Promise<TicketType> {
    return this.ticketTypes.create(eventId, dto);
  }

  /**
   * List the event's ticket tiers with availability.
   * @remarks Any active member of the event may view.
   */
  @Get()
  @UseGuards(EventAccessGuard)
  @ApiStandardResponse(TicketTypeResponseDto, {
    description: 'Ticket tiers',
    isArray: true,
  })
  @ApiProblemResponse(403, 'Not a member of this event')
  list(
    @Param('eventId') eventId: string,
  ): Promise<TicketTypeWithAvailability[]> {
    return this.ticketTypes.list(eventId);
  }
}
