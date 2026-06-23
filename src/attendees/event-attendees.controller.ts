import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Attendee } from '@prisma/client';
import {
  ApiPaginatedResponse,
  ApiProblemResponse,
} from '../common/decorators/api-standard-response.decorator';
import { Paginated } from '../common/pagination/paginated';
import { ApiTag } from '../openapi/api-tags';
import { ModuleGuard } from '../permissions/event-rbac.guards';
import { Module } from '../permissions/permissions.types';
import { RequireModule } from '../permissions/require-module.decorator';
import { AttendeeResponseDto } from './dto/attendee-response.dto';
import { ListAttendeesQuery } from './dto/list-attendees.query';
import { AttendeesService } from './attendees.service';

const DEFAULT_LIMIT = 20;

/** Organizer view of an event's attendees (`/events/{eventId}/attendees`). */
@ApiTags(ApiTag.Attendees)
@ApiBearerAuth()
@Controller('events/:eventId/attendees')
export class EventAttendeesController {
  constructor(private readonly attendees: AttendeesService) {}

  /**
   * List the event's attendees.
   * @remarks Requires the ATTENDEES module. Newest first, cursor-paginated; filter by email
   * status and a name/email search.
   */
  @Get()
  @UseGuards(ModuleGuard)
  @RequireModule(Module.Attendees)
  @ApiPaginatedResponse(AttendeeResponseDto, { description: 'Attendees' })
  @ApiProblemResponse(403, 'Missing ATTENDEES access')
  list(
    @Param('eventId') eventId: string,
    @Query() query: ListAttendeesQuery,
  ): Promise<Paginated<Attendee>> {
    return this.attendees.list(eventId, {
      limit: query.limit ?? DEFAULT_LIMIT,
      cursor: query.cursor,
      emailStatus: query.emailStatus,
      search: query.search,
    });
  }
}
