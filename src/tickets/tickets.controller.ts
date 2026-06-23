import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Ticket } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import {
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTag } from '../openapi/api-tags';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { TicketResponseDto } from './dto/ticket-response.dto';
import { TicketsService } from './tickets.service';

/** Ticket item operations (`/tickets/{id}`); event access is checked in-service. */
@ApiTags(ApiTag.Tickets)
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /**
   * Get a ticket with its tier and buyer.
   * @remarks Any active member of the ticket's event may view.
   */
  @Get(':id')
  @ApiStandardResponse(TicketResponseDto, { description: 'The ticket' })
  @ApiProblemResponse(403, 'Not a member of this event')
  @ApiProblemResponse(404, 'Ticket not found')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<Ticket> {
    return this.tickets.getById(user.id, id);
  }

  /**
   * Assign the ticket to an attendee.
   * @remarks The registration's buyer or a TICKETS-module holder may assign. Cutoff-gated and
   * optimistic-locked on `expectedUpdatedAt`; reassignment replaces the previous attendee.
   */
  @Post(':id/assignee')
  @ApiStandardResponse(TicketResponseDto, {
    description: 'The assigned ticket',
  })
  @ApiProblemResponse(409, 'Ticket changed since you read it (stale lock)')
  @ApiProblemResponse(400, 'Cutoff passed or custom-field validation failed')
  @ApiProblemResponse(403, 'Not the buyer and missing TICKETS access')
  @ApiProblemResponse(404, 'Ticket not found')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
  ): Promise<Ticket> {
    return this.tickets.assign(user.id, id, dto);
  }

  /**
   * Unassign the ticket (and delete its attendee).
   * @remarks Blocked once checked in; cutoff-gated and optimistic-locked. Pass the ticket's
   * current `updatedAt` as `expectedUpdatedAt`.
   */
  @Delete(':id/assignee')
  @ApiStandardResponse(TicketResponseDto, {
    description: 'The unassigned ticket',
  })
  @ApiProblemResponse(409, 'Ticket changed since you read it (stale lock)')
  @ApiProblemResponse(400, 'Checked in, cutoff passed, or not assigned')
  @ApiProblemResponse(403, 'Not the buyer and missing TICKETS access')
  @ApiProblemResponse(404, 'Ticket not found')
  unassign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('expectedUpdatedAt') expectedUpdatedAt: string,
  ): Promise<Ticket> {
    return this.tickets.unassign(user.id, id, new Date(expectedUpdatedAt));
  }
}
