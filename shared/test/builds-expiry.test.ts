import { describe, expect, it } from 'vitest';
import { isExpired } from '../src/builds';

const past = new Date(Date.now() - 1000);
const future = new Date(Date.now() + 100000);

describe('AC15: Premium builds are kept, Free builds expire', () => {
  it('expires a Free build after its date, and one with no date', () => {
    expect(isExpired({ plan: 'free', expiresAt: past })).toBe(true);
    expect(isExpired({ plan: 'free' })).toBe(true);
    expect(isExpired({ plan: 'free', expiresAt: future })).toBe(false);
  });
  it('never expires a Premium build', () => {
    expect(isExpired({ plan: 'premium', expiresAt: past })).toBe(false);
    expect(isExpired({ plan: 'premium', expiresAt: null })).toBe(false);
  });
});
