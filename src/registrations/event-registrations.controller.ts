import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Registration } from '@prisma/client';
import {
  ApiPaginatedResponse,
  ApiProblemResponse,
} from '../common/decorators/api-standard-response.decorator';
import { Paginated } from '../common/pagination/paginated';
import { ApiTag } from '../openapi/api-tags';
import { ModuleGuard } from '../permissions/event-rbac.guards';
import { Module } from '../permissions/permissions.types';
import { RequireModule } from '../permissions/require-module.decorator';
import { ListRegistrationsQuery } from './dto/list-registrations.query';
import { RegistrationResponseDto } from './dto/registration-response.dto';
import { RegistrationsService } from './registrations.service';

const DEFAULT_LIMIT = 20;

/** Organizer view of an event's registrations (`/events/{eventId}/registrations`). */
@ApiTags(ApiTag.Registrations)
@ApiBearerAuth()
@Controller('events/:eventId/registrations')
export class EventRegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  /**
   * List the event's registrations.
   * @remarks Requires the ATTENDEES module. Newest first, cursor-paginated.
   */
  @Get()
  @UseGuards(ModuleGuard)
  @RequireModule(Module.Attendees)
  @ApiPaginatedResponse(RegistrationResponseDto, {
    description: 'Registrations',
  })
  @ApiProblemResponse(403, 'Missing ATTENDEES access')
  list(
    @Param('eventId') eventId: string,
    @Query() query: ListRegistrationsQuery,
  ): Promise<Paginated<Registration>> {
    return this.registrations.list(eventId, {
      limit: query.limit ?? DEFAULT_LIMIT,
      cursor: query.cursor,
      ticketTypeId: query.ticketTypeId,
    });
  }
}
