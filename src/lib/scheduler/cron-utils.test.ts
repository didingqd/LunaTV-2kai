/** @jest-environment node */

import {
  getNextRun,
  normalizeCronExpression,
  validateCronExpression,
} from './cron-utils';

describe('scheduler cron utils', () => {
  it('accepts a valid Linux 5-field cron expression', () => {
    expect(validateCronExpression('*/30 * * * *')).toBe(true);
  });

  it('rejects invalid cron expressions', () => {
    expect(validateCronExpression('abc')).toBe(false);
  });

  it('rejects second-level cron expressions', () => {
    expect(validateCronExpression('*/5 * * * * *')).toBe(false);
  });

  it('normalizes whitespace and falls back on invalid input', () => {
    expect(normalizeCronExpression(' 0   */6 * * * ')).toBe('0 */6 * * *');
    expect(normalizeCronExpression('abc')).toBe('*/30 * * * *');
  });

  it('calculates the next run without starting a scheduler', () => {
    const nextRun = getNextRun(
      '*/30 * * * *',
      'UTC',
      new Date('2026-07-30T12:10:00.000Z'),
    );

    expect(nextRun?.toISOString()).toBe('2026-07-30T12:30:00.000Z');
  });

  it('calculates the next run in the configured timezone', () => {
    const nextRun = getNextRun(
      '0 9 * * *',
      'Asia/Shanghai',
      new Date('2026-07-30T00:10:00.000Z'),
    );

    expect(nextRun?.toISOString()).toBe('2026-07-30T01:00:00.000Z');
  });

  it('throws for invalid next-run inputs', () => {
    expect(() => getNextRun('abc', 'UTC')).toThrow('Invalid cron expression');
    expect(() => getNextRun('*/30 * * * *', 'invalid/timezone')).toThrow(
      'Invalid timezone',
    );
  });
});
