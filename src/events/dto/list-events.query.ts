import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { EVENT_STATUSES, EventStatus } from '../event.constants';

/** Query params for cursor-paginated event listing. */
export class ListEventsQuery {
  /** Max items per page (1–100, default 20). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Opaque cursor (an event id) to fetch the page after it. */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** Filter to a single lifecycle status. */
  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: EventStatus;
}
