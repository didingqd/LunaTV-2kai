/** @jest-environment node */

import {
  normalizeTimezone,
  SCHEDULER_TIMEZONE_PRESETS,
  validateTimezone,
} from './timezone-utils';

describe('scheduler timezone utils', () => {
  it('accepts supported IANA timezones', () => {
    expect(validateTimezone('UTC')).toBe(true);
    expect(validateTimezone('Europe/Berlin')).toBe(true);
    expect(validateTimezone('Asia/Shanghai')).toBe(true);
  });

  it('rejects invalid timezones', () => {
    expect(validateTimezone('invalid/timezone')).toBe(false);
    expect(validateTimezone('')).toBe(false);
  });

  it('normalizes valid timezone input and falls back on invalid input', () => {
    expect(normalizeTimezone(' Asia/Tokyo ')).toBe('Asia/Tokyo');
    expect(normalizeTimezone('invalid/timezone')).toBe('UTC');
  });

  it('includes the documented preset timezones', () => {
    expect(SCHEDULER_TIMEZONE_PRESETS).toEqual([
      'UTC',
      'Asia/Shanghai',
      'Europe/Berlin',
      'Asia/Tokyo',
      'America/New_York',
      'America/Los_Angeles',
    ]);
  });
});
