import type { NotificationEventMeta } from '@/lib/notification/notification-event-metadata';

interface NotificationEventSelectorProps {
  events: NotificationEventMeta[];
  subscribedEvents: string[];
  onToggle: (eventType: string) => void;
}

export function NotificationEventSelector({
  events,
  subscribedEvents,
  onToggle,
}: NotificationEventSelectorProps) {
  return (
    <section className='space-y-3'>
      <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
        通知事件
      </h4>
      <div className='grid gap-2 sm:grid-cols-2'>
        {events.map((eventMeta) => {
          const checked = subscribedEvents.includes(eventMeta.type);
          return (
            <label
              key={eventMeta.type}
              className='flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
            >
              <input
                type='checkbox'
                checked={checked}
                aria-label={eventMeta.label}
                onChange={() => onToggle(eventMeta.type)}
                className='mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-700'
              />
              <span>
                <span className='block font-medium text-gray-800 dark:text-gray-100'>
                  {eventMeta.label}
                </span>
                <span className='mt-0.5 block text-xs text-gray-500 dark:text-gray-400'>
                  {eventMeta.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
