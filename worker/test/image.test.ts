import { describe, expect, it } from 'vitest';
import { assertImageMatches } from '../src/image';

describe('AC3: image version', () => {
  it('accepts the image built from the current version.json', async () => {
    await expect(assertImageMatches('sitetoapk-builder:dev')).resolves.toBeUndefined();
  });

  it('refuses an image built from another version.json', async () => {
    await expect(assertImageMatches('sitetoapk-builder:dev', 'deadbeef')).rejects.toThrow('does not match');
  });

  it('refuses a missing image', async () => {
    await expect(assertImageMatches('sitetoapk-builder:missing')).rejects.toThrow();
  });
});
