import type { NotificationProviderMeta } from '../notification-settings-provider-ui';
import type { ChannelFormState } from './notification-settings-types';

interface NotificationConfigSectionProps {
  form: ChannelFormState;
  provider: NotificationProviderMeta;
  onChange: (next: ChannelFormState) => void;
}

export function NotificationConfigSection({
  form,
  provider,
  onChange,
}: NotificationConfigSectionProps) {
  return (
    <>
      <section className='space-y-3'>
        <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
          基础信息
        </h4>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-200'>
          渠道名称
          <input
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            className='mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
            placeholder='例如：服务器通知'
          />
        </label>
      </section>

      <section className='space-y-3'>
        <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
          通知服务配置
        </h4>
        {provider.configSchema.fields.length === 0 ? (
          <div className='rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
            当前通知方式无需额外配置。
          </div>
        ) : (
          <div className='space-y-3'>
            {provider.configSchema.fields.map((field) => (
              <label
                key={field.key}
                className='block text-sm font-medium text-gray-700 dark:text-gray-200'
              >
                {field.label}
                {field.required && <span className='text-red-500'> *</span>}
                <input
                  type={field.type === 'password' ? 'password' : 'text'}
                  inputMode={field.type === 'url' ? 'url' : undefined}
                  value={form.config[field.key] ?? ''}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      config: {
                        ...form.config,
                        [field.key]: event.target.value,
                      },
                    })
                  }
                  className='mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100'
                  placeholder={field.placeholder}
                />
                {field.description && (
                  <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                    {field.description}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
