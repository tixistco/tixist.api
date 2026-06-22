import { IsString, Length } from 'class-validator';

export class InvitationTokenDto {
  /**
   * The 43-character invitation token from the invite link.
   * @example "QV9k8s2bGmF1tQx0pZ7nJ4cR6yL3wH8aD5eK2uN0iT9"
   */
  @IsString()
  @Length(43, 43)
  token!: string;
}
