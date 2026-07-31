import type { NotificationProviderMeta } from '../notification-settings-provider-ui';

interface NotificationProviderPickerProps {
  providers: NotificationProviderMeta[];
  saving: boolean;
  onPick: (providerType: string) => void;
}

// Picker intentionally renders presentation metadata only: icon, name and a
// concise description. Backend type/schema/capabilities have already been
// merged by the page container before this component receives its props.
export function NotificationProviderPicker({
  providers,
  saving,
  onPick,
}: NotificationProviderPickerProps) {
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      {providers.map((provider) => {
        const Icon = provider.icon;
        return (
          <button
            key={provider.type}
            type='button'
            disabled={saving}
            onClick={() => onPick(provider.type)}
            className='group flex min-h-24 items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
          >
            <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300'>
              <Icon className='h-5 w-5' />
            </span>
            <span className='min-w-0'>
              <span className='block text-sm font-semibold text-gray-900 dark:text-gray-100'>
                {provider.displayName}
              </span>
              <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                {provider.description}
              </span>
              {!provider.capabilities.canSend && (
                <span className='mt-2 block text-xs font-medium text-amber-700 dark:text-amber-300'>
                  发送能力待实现
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
