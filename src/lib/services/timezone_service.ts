import { normalizeTimezone } from '@/lib/scheduler/timezone-utils';

export type TimezoneDateInput = Date | number | string;

function toDate(value: TimezoneDateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function format(date: TimezoneDateInput, timezone: string): string {
  const normalizedTimezone = normalizeTimezone(timezone);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: normalizedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(toDate(date));
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get('year')}-${values.get('month')}-${values.get(
    'day',
  )} ${values.get('hour')}:${values.get('minute')}:${values.get('second')}`;
}

export const timezoneService = {
  format,
};
