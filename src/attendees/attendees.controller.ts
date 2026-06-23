import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Attendee } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import {
  ApiProblemResponse,
  ApiStandardResponse,
} from '../common/decorators/api-standard-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiTag } from '../openapi/api-tags';
import { AttendeeResponseDto } from './dto/attendee-response.dto';
import { AttendeesService } from './attendees.service';

/** Attendee item operations (`/attendees/{id}`); event access is checked in-service. */
@ApiTags(ApiTag.Attendees)
@ApiBearerAuth()
@Controller('attendees')
export class AttendeesController {
  constructor(private readonly attendees: AttendeesService) {}

  /**
   * Get an attendee with their ticket.
   * @remarks Any active member of the attendee's event may view.
   */
  @Get(':id')
  @ApiStandardResponse(AttendeeResponseDto, { description: 'The attendee' })
  @ApiProblemResponse(403, 'Not a member of this event')
  @ApiProblemResponse(404, 'Attendee not found')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<Attendee> {
    return this.attendees.getById(user.id, id);
  }
}
