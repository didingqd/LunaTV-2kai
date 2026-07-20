import { buildSkipConfigKey } from './skip-config-identity';

const config = { enable: true, intro_time: 90, outro_time: -60 };
const originalFetch = global.fetch;

describe('SkipConfig identity in Local and Online modes', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    localStorage.clear();
    document.cookie = 'user_auth=; Max-Age=0; path=/';
    delete (window as any).RUNTIME_CONFIG;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as { fetch?: typeof fetch }).fetch;
    }
    delete (window as any).RUNTIME_CONFIG;
  });

  it('creates, gets, and deletes a special-character Local identity', async () => {
    (window as any).RUNTIME_CONFIG = { STORAGE_TYPE: 'localstorage' };
    const { deleteSkipConfig, getSkipConfig, saveSkipConfig } =
      await import('./db.client');
    const key = buildSkipConfigKey('a+b', '123+456');

    await saveSkipConfig('a+b', '123+456', config);
    expect(JSON.parse(localStorage.getItem('moontv_skip_configs')!)).toEqual({
      [key]: config,
    });
    await expect(getSkipConfig('a+b', '123+456')).resolves.toEqual(config);

    await saveSkipConfig('other', '123+456', {
      ...config,
      intro_time: 30,
    });
    await deleteSkipConfig('a+b', '123+456');
    expect(JSON.parse(localStorage.getItem('moontv_skip_configs')!)).toEqual({
      [buildSkipConfigKey('other', '123+456')]: {
        ...config,
        intro_time: 30,
      },
    });
  });

  it('lazily adds canonical Local data without deleting legacy data', async () => {
    (window as any).RUNTIME_CONFIG = { STORAGE_TYPE: 'localstorage' };
    localStorage.setItem(
      'moontv_skip_configs',
      JSON.stringify({ 'bangumi+123': config }),
    );
    const { getSkipConfig } = await import('./db.client');

    await expect(getSkipConfig('bangumi', '123')).resolves.toEqual(config);
    expect(JSON.parse(localStorage.getItem('moontv_skip_configs')!)).toEqual({
      'bangumi+123': config,
      [buildSkipConfigKey('bangumi', '123')]: config,
    });
  });

  it('uses the same canonical identity for Online get, set, and delete', async () => {
    (window as any).RUNTIME_CONFIG = { STORAGE_TYPE: 'redis' };
    document.cookie = `user_auth=${encodeURIComponent(
      JSON.stringify({ username: 'alice' }),
    )}; path=/`;
    const fetchMock = jest.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { action: string };
      return {
        ok: true,
        json: async () =>
          body.action === 'get' ? { config } : { success: true },
      } as Response;
    });
    global.fetch = fetchMock as typeof fetch;
    const { deleteSkipConfig, getSkipConfig, saveSkipConfig } =
      await import('./db.client');
    const key = buildSkipConfigKey('a+b', '123+456');

    await expect(getSkipConfig('a+b', '123+456')).resolves.toEqual(config);
    await saveSkipConfig('a+b', '123+456', config);
    await deleteSkipConfig('a+b', '123+456');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ key });
    }
  });
});
