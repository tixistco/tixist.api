import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Event } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import {
  ApiPaginatedResponse,
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Paginated } from '../common/pagination/paginated';
import { EventAccessGuard, OwnerGuard } from '../permissions/event-rbac.guards';
import { ApiTag } from '../openapi/api-tags';
import { CreateEventDto } from './dto/create-event.dto';
import {
  EventMetricsDto,
  EventResponseDto,
  EventStatusCountsDto,
} from './dto/event-response.dto';
import { ListEventsQuery } from './dto/list-events.query';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventMetrics, EventsService } from './events.service';

const DEFAULT_LIMIT = 20;

@ApiTags(ApiTag.Events)
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Create an event.
   * @remarks The caller becomes the organizer/owner. The slug must be globally unique.
   */
  @Post()
  @HttpCode(201)
  @ApiStandardResponse(EventResponseDto, {
    status: 201,
    description: 'Created',
  })
  @ApiProblemResponse(409, 'Slug already in use')
  @ApiProblemResponse(400, 'Validation failed')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEventDto,
  ): Promise<Event> {
    return this.events.create(user, dto);
  }

  /**
   * List the caller's own events.
   * @remarks Newest first, cursor-paginated. Optionally filter by lifecycle status.
   */
  @Get()
  @ApiPaginatedResponse(EventResponseDto, {
    description: "The caller's events",
  })
  listMine(
    @CurrentUser() user: AuthUser,
    @Query() query: ListEventsQuery,
  ): Promise<Paginated<Event>> {
    return this.events.listMine(user.id, {
      limit: query.limit ?? DEFAULT_LIMIT,
      cursor: query.cursor,
      status: query.status,
    });
  }

  /**
   * Counts of the caller's events grouped by status.
   */
  @Get('status-counts')
  @ApiStandardResponse(EventStatusCountsDto, {
    description: 'Counts per status',
  })
  statusCounts(@CurrentUser() user: AuthUser): Promise<EventStatusCountsDto> {
    return this.events.statusCounts(user.id);
  }

  /**
   * Get an event by id.
   * @remarks Any active team member of the event (owner or collaborator) may read it.
   */
  @Get(':id')
  @UseGuards(EventAccessGuard)
  @ApiStandardResponse(EventResponseDto, { description: 'The event' })
  @ApiProblemResponse(403, 'Not a member of this event')
  @ApiProblemResponse(404, 'Event not found')
  getById(@Param('id') id: string): Promise<Event> {
    return this.events.findById(id);
  }

  /**
   * Dashboard metrics for an event.
   * @remarks Any active member may view: registration, ticket, assignment and check-in rollups.
   */
  @Get(':id/metrics')
  @UseGuards(EventAccessGuard)
  @ApiStandardResponse(EventMetricsDto, { description: 'Event metrics' })
  @ApiProblemResponse(403, 'Not a member of this event')
  metrics(@Param('id') id: string): Promise<EventMetrics> {
    return this.events.metrics(id);
  }

  /**
   * Update an event.
   * @remarks Owner only. Patch any subset of fields; changing the slug re-checks uniqueness.
   */
  @Patch(':id')
  @UseGuards(OwnerGuard)
  @ApiStandardResponse(EventResponseDto, { description: 'The updated event' })
  @ApiProblemResponse(409, 'Slug already in use')
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Event not found')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto): Promise<Event> {
    return this.events.update(id, dto);
  }

  /**
   * Soft-archive an event.
   * @remarks Owner only. Hides it from the public surface; reversible via restore.
   */
  @Post(':id/archive')
  @UseGuards(OwnerGuard)
  @ApiStandardResponse(EventResponseDto, { description: 'The archived event' })
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Event not found')
  archive(@Param('id') id: string): Promise<Event> {
    return this.events.archive(id);
  }

  /**
   * Restore an archived event back to draft.
   * @remarks Owner only.
   */
  @Post(':id/restore')
  @UseGuards(OwnerGuard)
  @ApiStandardResponse(EventResponseDto, { description: 'The restored event' })
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Event not found')
  restore(@Param('id') id: string): Promise<Event> {
    return this.events.restore(id);
  }

  /**
   * Permanently delete an event.
   * @remarks Owner only. Cascades to all the event's child records. Cannot be undone.
   */
  @Delete(':id')
  @UseGuards(OwnerGuard)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiProblemResponse(403, 'Not the owner')
  @ApiProblemResponse(404, 'Event not found')
  remove(@Param('id') id: string): Promise<void> {
    return this.events.remove(id);
  }
}
