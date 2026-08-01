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
jest.mock('./notification-log-repository', () => ({
  notificationSendLogRepository: {
    getProviderHealth: jest.fn(async () => ({})),
  },
}));

import { notificationProviderRegistry } from './notification-provider-bootstrap';
import { notificationSendLogRepository } from './notification-log-repository';
import { buildNotificationProvidersPayload } from './notification-provider-api';
import {
  listNotificationProviderPresentationTypes,
  NOTIFICATION_PROVIDER_PRESENTATIONS,
} from './notification-provider-presentation';
import { schemaOnlyNotificationProviderTypes } from './providers/schema-only-notification-providers';

const getProviderHealth =
  notificationSendLogRepository.getProviderHealth as jest.Mock;

describe('NotificationProviderRegistry metadata contract', () => {
  it('matches registered provider types with presentation metadata exactly', () => {
    const registryTypes = notificationProviderRegistry
      .list()
      .map((provider) => provider.type)
      .sort();
    const presentationTypes =
      listNotificationProviderPresentationTypes().sort();

    expect(presentationTypes).toEqual(registryTypes);

    for (const providerType of registryTypes) {
      expect(NOTIFICATION_PROVIDER_PRESENTATIONS[providerType]).toBeDefined();
    }
  });

  it('outputs every registered provider through the notification providers API payload', async () => {
    const registryTypes = notificationProviderRegistry
      .list()
      .map((provider) => provider.type)
      .sort();
    const apiTypes = (await buildNotificationProvidersPayload()).providers
      .map((provider) => provider.type)
      .sort();

    expect(apiTypes).toEqual(registryTypes);
  });

  it('marks schema-only preview providers as configurable but not sendable', async () => {
    const providers = notificationProviderRegistry.list();
    const apiProviders = (await buildNotificationProvidersPayload()).providers;

    for (const providerType of schemaOnlyNotificationProviderTypes) {
      const provider = providers.find(
        (candidate) => candidate.type === providerType,
      );
      const apiProvider = apiProviders.find(
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
      expect(apiProvider?.deliveryStatus).toBe('preview');
    }
  });

  it('includes provider health from recent notification logs', async () => {
    getProviderHealth.mockResolvedValueOnce({ webhook: 'failed' });

    const apiProviders = (await buildNotificationProvidersPayload()).providers;

    expect(
      apiProviders.find((provider) => provider.type === 'webhook')
        ?.healthStatus,
    ).toBe('failed');
  });
});
