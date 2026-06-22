import { IsIn, IsOptional } from 'class-validator';

export const TEAM_MEMBER_STATUSES = ['PENDING', 'ACTIVE', 'REMOVED'] as const;

export class ListMembersQuery {
  /** Filter members by status. */
  @IsOptional()
  @IsIn(TEAM_MEMBER_STATUSES)
  status?: (typeof TEAM_MEMBER_STATUSES)[number];
}
