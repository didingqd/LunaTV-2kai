import { NOTIFICATION_PROVIDER_UI_METAS } from '@/components/notification-settings-provider-ui';

jest.mock('./providers/inbox-notification-provider', () => ({
  inboxNotificationProvider: {
    type: 'inbox',
    send: jest.fn(async () => undefined),
    test: jest.fn(async () => undefined),
    validateConfig: jest.fn(() => ({})),
    getDisplayName: jest.fn(() => '站内通知'),
    getConfigSchema: jest.fn(() => ({ fields: [] })),
  },
}));

import { notificationProviderRegistry } from './notification-provider-bootstrap';
import { schemaOnlyNotificationProviderTypes } from './providers/schema-only-notification-providers';

describe('NotificationProviderRegistry metadata contract', () => {
  it('registers every provider type exposed by UI presentation metadata', () => {
    const backendTypes = new Set(
      notificationProviderRegistry.list().map((provider) => provider.type),
    );

    for (const uiProvider of NOTIFICATION_PROVIDER_UI_METAS) {
      expect(backendTypes.has(uiProvider.type)).toBe(true);
    }
  });

  it('marks schema-only preview providers as configurable but not sendable', () => {
    const providers = notificationProviderRegistry.list();

    for (const providerType of schemaOnlyNotificationProviderTypes) {
      const provider = providers.find(
        (candidate) => candidate.type === providerType,
      );
      expect(provider).toBeDefined();
      expect(provider?.capabilities).toEqual(
        expect.objectContaining({
          canCreate: true,
          canEdit: true,
          canTest: true,
          canSend: false,
        }),
      );
    }
  });
});
