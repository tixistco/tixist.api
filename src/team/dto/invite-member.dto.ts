import { ArrayMinSize, ArrayUnique, IsEmail, IsIn } from 'class-validator';
import { MODULE_NAMES, ModuleName } from '../../permissions/permissions.types';

export class InviteMemberDto {
  /**
   * Email of the person to invite. Normalized to lowercase.
   * @example "collaborator@example.com"
   */
  @IsEmail()
  email!: string;

  /**
   * Modules the collaborator may access (at least one; no duplicates). `SETTINGS`
   * is owner-only and not assignable here.
   * @example ["CFP", "ATTENDEES"]
   */
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(MODULE_NAMES, { each: true })
  modulePermissions!: ModuleName[];
}
