import { ArrayMinSize, ArrayUnique, IsIn } from 'class-validator';
import { MODULE_NAMES, ModuleName } from '../../permissions/permissions.types';

export class UpdatePermissionsDto {
  /**
   * The collaborator's new module set (at least one; no duplicates). Replaces the
   * previous set wholesale.
   * @example ["CFP"]
   */
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(MODULE_NAMES, { each: true })
  modulePermissions!: ModuleName[];
}
