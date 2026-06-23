import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** The person a ticket is being assigned to. */
export class AttendeeInputDto {
  /**
   * Attendee name.
   * @example "Ada Lovelace"
   */
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * Attendee email.
   * @example "ada@example.com"
   */
  @IsEmail()
  email!: string;

  /**
   * Answers to the event's custom registration fields, keyed by field id. Validated
   * against the event's `customFields`.
   * @example { "tshirt": "M", "diet": ["vegan"] }
   */
  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
}

export class AssignTicketDto {
  /** The attendee to assign the ticket to. */
  @ValidateNested()
  @Type(() => AttendeeInputDto)
  attendee!: AttendeeInputDto;

  /**
   * The ticket's current `updatedAt`, for optimistic-locking. A mismatch means the
   * ticket changed since you read it → 409.
   */
  @Type(() => Date)
  @IsDate()
  expectedUpdatedAt!: Date;
}
