import { Injectable } from '@nestjs/common';
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';

@Injectable()
export class HashingService {
  private readonly rounds = 12;

  hash(plain: string): Promise<string> {
    return bcryptHash(plain, this.rounds);
  }

  compare(plain: string, hashed: string): Promise<boolean> {
    return bcryptCompare(plain, hashed);
  }
}
