import { ChevronRight } from 'lucide-react';

import { type NotificationProviderMeta } from '../notification-settings-provider-ui';

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
    <div className='space-y-2'>
      {providers.map((provider) => {
        const Icon = provider.icon;
        return (
          <button
            key={provider.type}
            type='button'
            disabled={saving}
            onClick={() => onPick(provider.type)}
            className='group flex min-h-20 w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
          >
            <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 transition group-hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300'>
              <Icon className='h-5 w-5' />
            </span>
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                {provider.displayName}
              </span>
              <span className='mt-1 line-clamp-2 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                {provider.description}
              </span>
            </span>
            <ChevronRight className='h-4 w-4 shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-500 dark:text-gray-500 dark:group-hover:text-blue-300' />
          </button>
        );
      })}
    </div>
  );
}
