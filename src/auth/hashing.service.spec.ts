import { describe, expect, it } from '@jest/globals';
import { HashingService } from './hashing.service';

describe('HashingService', () => {
  const service = new HashingService();

  it('hashes a value to something different from the plaintext', async () => {
    const hash = await service.hash('s3cret-password');
    expect(hash).not.toBe('s3cret-password');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('compare() is true for a matching plaintext', async () => {
    const hash = await service.hash('s3cret-password');
    await expect(service.compare('s3cret-password', hash)).resolves.toBe(true);
  });

  it('compare() is false for a non-matching plaintext', async () => {
    const hash = await service.hash('s3cret-password');
    await expect(service.compare('wrong', hash)).resolves.toBe(false);
  });
});
