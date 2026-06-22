import { TeamMemberStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListMembersQuery {
  /** Filter members by status. */
  @IsOptional()
  @IsEnum(TeamMemberStatus)
  status?: TeamMemberStatus;
}
