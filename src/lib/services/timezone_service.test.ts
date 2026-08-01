import { timezoneService } from './timezone_service';

describe('timezoneService', () => {
  it('formats a UTC instant for the configured timezone', () => {
    const timestamp = '2026-08-01T01:00:00.000Z';

    expect(timezoneService.format(timestamp, 'Asia/Shanghai')).toBe(
      '2026-08-01 09:00:00',
    );
    expect(timezoneService.format(timestamp, 'America/New_York')).toBe(
      '2026-07-31 21:00:00',
    );
  });
});
