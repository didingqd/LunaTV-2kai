import { Cron } from 'croner';

import { DEFAULT_SCHEDULER_TIMEZONE, validateTimezone } from './timezone-utils';

export const DEFAULT_UPDATE_CHECK_CRON_EXPRESSION = '*/30 * * * *';

function normalizeCronExpressionInput(expression: string): string {
  return expression.trim().replace(/\s+/g, ' ');
}

function isFiveFieldCronExpression(expression: string): boolean {
  return normalizeCronExpressionInput(expression).split(' ').length === 5;
}

export function validateCronExpression(expression: string): boolean {
  const normalized = normalizeCronExpressionInput(expression);
  if (!normalized || !isFiveFieldCronExpression(normalized)) return false;

  try {
    new Cron(normalized, { mode: '5-part', paused: true });
    return true;
  } catch {
    return false;
  }
}

export function normalizeCronExpression(
  expression: unknown,
  fallback = DEFAULT_UPDATE_CHECK_CRON_EXPRESSION,
): string {
  if (typeof expression !== 'string') return fallback;

  const normalized = normalizeCronExpressionInput(expression);
  return validateCronExpression(normalized) ? normalized : fallback;
}

export function getNextRun(
  expression: string,
  timezone = DEFAULT_SCHEDULER_TIMEZONE,
  from = new Date(),
): Date | null {
  const normalized = normalizeCronExpressionInput(expression);
  const normalizedTimezone = timezone.trim();

  if (!validateCronExpression(normalized)) {
    throw new Error('Invalid cron expression');
  }
  if (!validateTimezone(normalizedTimezone)) {
    throw new Error('Invalid timezone');
  }

  const cron = new Cron(normalized, {
    mode: '5-part',
    paused: true,
    timezone: normalizedTimezone,
  });
  return cron.nextRun(from);
}
