import {
  normalizeSkipConfigRecord,
  normalizeSkipConfigValue,
} from './skip-config';

describe('SkipConfig canonical mapper', () => {
  it('keeps positive intro/outro seconds unchanged', () => {
    expect(
      normalizeSkipConfigValue({
        enable: true,
        intro_time: 15,
        outro_time: 45,
      }),
    ).toEqual({ enable: true, intro_time: 15, outro_time: 45 });
  });

  it('converts legacy negative outro_time to positive seconds from video end', () => {
    expect(
      normalizeSkipConfigValue({
        enable: true,
        intro_time: 15,
        outro_time: -45,
      }),
    ).toEqual({ enable: true, intro_time: 15, outro_time: 45 });
  });

  it('infers missing enable from actual skip seconds', () => {
    expect(
      normalizeSkipConfigValue({
        intro_time: 0,
        outro_time: 30,
      }),
    ).toEqual({ enable: true, intro_time: 0, outro_time: 30 });
  });

  it('rejects invalid payloads and drops invalid record entries', () => {
    expect(normalizeSkipConfigValue({ intro_time: {}, outro_time: 30 })).toBe(
      null,
    );
    expect(
      normalizeSkipConfigRecord({
        valid: { enable: false, intro_time: 0, outro_time: 0 },
        invalid: { enable: true, intro_time: {}, outro_time: 30 } as any,
      }),
    ).toEqual({
      valid: { enable: false, intro_time: 0, outro_time: 0 },
    });
  });
});
