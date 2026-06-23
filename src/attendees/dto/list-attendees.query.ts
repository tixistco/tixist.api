import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { EMAIL_STATUSES, EmailStatus } from '../attendee.constants';

export class ListAttendeesQuery {
  /** Max items per page (1–100, default 20). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Opaque cursor (an attendee id) to fetch the page after it. */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** Filter by email deliverability status. */
  @IsOptional()
  @IsIn(EMAIL_STATUSES)
  emailStatus?: EmailStatus;

  /** Case-insensitive match on name or email. */
  @IsOptional()
  @IsString()
  search?: string;
}
