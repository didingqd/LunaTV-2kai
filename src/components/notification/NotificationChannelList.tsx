import type { NotificationProviderMeta } from '../notification-settings-provider-ui';
import { NotificationBatchToolbar } from './NotificationBatchToolbar';
import { NotificationChannelItem } from './NotificationChannelItem';
import type { NotificationChannelConfig } from './notification-settings-types';

interface NotificationChannelListProps {
  channels: NotificationChannelConfig[];
  updatedAtLabel: string | null;
  providerByType: Map<string, NotificationProviderMeta>;
  batchMode: boolean;
  selectedChannelIds: string[];
  saving: boolean;
  channelSavingId: string | null;
  allSelected: boolean;
  selectedDeletableCount: number;
  onSelectAll: () => void;
  onBatchEnable: () => void;
  onBatchDisable: () => void;
  onBatchDelete: () => void;
  onExitBatch: () => void;
  onSelectChannel: (channelId: string) => void;
  onToggleChannel: (channel: NotificationChannelConfig) => void;
  onTestChannel: (channel: NotificationChannelConfig) => void;
  onEditChannel: (channel: NotificationChannelConfig) => void;
  onDeleteChannel: (channel: NotificationChannelConfig) => void;
}

export function NotificationChannelList({
  channels,
  updatedAtLabel,
  providerByType,
  batchMode,
  selectedChannelIds,
  saving,
  channelSavingId,
  allSelected,
  selectedDeletableCount,
  onSelectAll,
  onBatchEnable,
  onBatchDisable,
  onBatchDelete,
  onExitBatch,
  onSelectChannel,
  onToggleChannel,
  onTestChannel,
  onEditChannel,
  onDeleteChannel,
}: NotificationChannelListProps) {
  return (
    <section className='rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950/80'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            通知渠道
          </h2>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            管理已创建的通知渠道。
          </p>
        </div>
        {updatedAtLabel && (
          <span className='hidden rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400 sm:inline-flex'>
            更新于 {updatedAtLabel}
          </span>
        )}
      </div>

      <NotificationBatchToolbar
        visible={batchMode}
        saving={saving}
        selectedCount={selectedChannelIds.length}
        hasChannels={channels.length > 0}
        allSelected={allSelected}
        hasDeletableSelection={selectedDeletableCount > 0}
        onSelectAll={onSelectAll}
        onEnable={onBatchEnable}
        onDisable={onBatchDisable}
        onDelete={onBatchDelete}
        onExit={onExitBatch}
      />

      {channels.length === 0 ? (
        <div className='rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          暂无通知渠道，请先添加一个通知渠道。
        </div>
      ) : (
        <div className='space-y-3'>
          {channels.map((channel) => {
            const provider = providerByType.get(channel.type);
            if (!provider) return null;
            return (
              <NotificationChannelItem
                key={channel.id}
                channel={channel}
                provider={provider}
                batchMode={batchMode}
                selected={selectedChannelIds.includes(channel.id)}
                saving={saving}
                pending={channelSavingId === channel.id}
                onSelect={() => onSelectChannel(channel.id)}
                onToggle={() => onToggleChannel(channel)}
                onTest={() => onTestChannel(channel)}
                onEdit={() => onEditChannel(channel)}
                onDelete={() => onDeleteChannel(channel)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
