interface NotificationBatchToolbarProps {
  visible: boolean;
  saving: boolean;
  selectedCount: number;
  hasChannels: boolean;
  allSelected: boolean;
  hasDeletableSelection: boolean;
  onSelectAll: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onExit: () => void;
}

export function NotificationBatchToolbar({
  visible,
  saving,
  selectedCount,
  hasChannels,
  allSelected,
  hasDeletableSelection,
  onSelectAll,
  onEnable,
  onDisable,
  onDelete,
  onExit,
}: NotificationBatchToolbarProps) {
  if (!visible) return null;

  return (
    <div className='mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20 md:flex-row md:items-center md:justify-between'>
      <div>
        <div className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
          批量管理
        </div>
        <div className='text-xs text-gray-500 dark:text-gray-400'>
          已选择 {selectedCount} 项
        </div>
      </div>
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          disabled={saving || !hasChannels}
          onClick={onSelectAll}
          className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
        >
          {allSelected ? '取消全选' : '全选'}
        </button>
        <button
          type='button'
          disabled={saving || selectedCount === 0}
          onClick={onEnable}
          className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
        >
          启用
        </button>
        <button
          type='button'
          disabled={saving || selectedCount === 0}
          onClick={onDisable}
          className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
        >
          关闭
        </button>
        <button
          type='button'
          disabled={saving || !hasDeletableSelection}
          onClick={onDelete}
          className='rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-gray-950 dark:text-red-300 dark:hover:bg-red-950/30'
        >
          删除
        </button>
        <button
          type='button'
          disabled={saving}
          onClick={onExit}
          className='rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900'
        >
          退出
        </button>
      </div>
    </div>
  );
}
