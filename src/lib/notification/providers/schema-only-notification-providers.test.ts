import type { UserNotificationChannelConfig } from '../notification-settings-repository';
import { schemaOnlyNotificationProviders } from './schema-only-notification-providers';

describe('schema-only notification providers', () => {
  it('validate configuration without pretending to deliver externally', async () => {
    const provider = schemaOnlyNotificationProviders[0];
    expect(provider).toBeDefined();

    const config = provider
      .getConfigSchema()
      .fields.reduce<Record<string, string>>((next, field) => {
        next[field.key] =
          field.type === 'url' ? 'https://example.com' : 'value';
        return next;
      }, {});
    const channel = {
      id: 'preview',
      type: provider.type,
      name: 'Preview provider',
      enabled: true,
      subscribedEvents: ['system.error'],
      config,
    } satisfies UserNotificationChannelConfig;

    await expect(provider.test(channel)).resolves.toBeUndefined();
    await expect(
      provider.send(
        {
          id: 'preview-event',
          userId: 'alice',
          type: 'system.error',
          title: 'preview',
          body: 'preview only',
          content: 'preview only',
          createdAt: Date.now(),
        },
        channel,
      ),
    ).resolves.toBeUndefined();
  });
});
