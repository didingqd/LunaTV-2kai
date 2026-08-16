import { BaseRedisStorage } from './redis-base.db';
import { buildSkipConfigKey } from './skip-config-identity';

const enabled = { enable: true, intro_time: 90, outro_time: 60 };
const disabled = { enable: false, intro_time: 0, outro_time: 0 };

describe('Redis SkipConfig identity storage', () => {
  it('writes special-character identities with canonical fields', async () => {
    const { storage, values } = createStorage();
    const key = buildSkipConfigKey('a+b', '123+456');

    await storage.setSkipConfig('alice', 'a+b', '123+456', enabled);

    expect(values.get(key)).toBe(JSON.stringify(enabled));
  });

  it('prefers canonical data over a matching legacy field', async () => {
    const canonicalKey = buildSkipConfigKey('bangumi', '123');
    const { storage } = createStorage({
      'bangumi+123': JSON.stringify(disabled),
      [canonicalKey]: JSON.stringify(enabled),
    });

    await expect(
      storage.getSkipConfig('alice', 'bangumi', '123'),
    ).resolves.toEqual(enabled);
  });

  it('lazily writes canonical data without deleting legacy data', async () => {
    const canonicalKey = buildSkipConfigKey('bangumi', '123');
    const { storage, values } = createStorage({
      'bangumi+123': JSON.stringify(enabled),
    });

    await expect(
      storage.getSkipConfig('alice', 'bangumi', '123'),
    ).resolves.toEqual(enabled);
    expect(values.get(canonicalKey)).toBe(JSON.stringify(enabled));
    expect(values.get('bangumi+123')).toBe(JSON.stringify(enabled));
  });

  it('deletes only the requested identity and its safe legacy field', async () => {
    const target = buildSkipConfigKey('bangumi', '123');
    const other = buildSkipConfigKey('bangumi', '124');
    const { storage, values } = createStorage({
      [target]: JSON.stringify(enabled),
      'bangumi+123': JSON.stringify(enabled),
      [other]: JSON.stringify(disabled),
    });

    await storage.deleteSkipConfig('alice', 'bangumi', '123');

    expect(values.has(target)).toBe(false);
    expect(values.has('bangumi+123')).toBe(false);
    expect(values.get(other)).toBe(JSON.stringify(disabled));
  });

  it('preserves the existing semantic identity field', async () => {
    const { storage, values } = createStorage();

    await storage.setSkipConfig(
      'alice',
      'title:C++ Primer:2026',
      '__identity__',
      enabled,
    );

    expect(values.get('title:C++ Primer:2026+__identity__')).toBe(
      JSON.stringify(enabled),
    );
  });
});

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const client = {
    hGet: jest.fn(
      async (_hash: string, field: string) => values.get(field) ?? null,
    ),
    hSet: jest.fn(async (_hash: string, field: string, value: string) => {
      values.set(field, value);
      return 1;
    }),
    hDel: jest.fn(async (_hash: string, field: string) => {
      const existed = values.delete(field);
      return existed ? 1 : 0;
    }),
    hGetAll: jest.fn(async () => Object.fromEntries(values)),
  };
  const storage = Object.create(BaseRedisStorage.prototype) as any;
  storage.client = client;
  storage.withRetry = (operation) => operation();
  return { storage, values };
}
