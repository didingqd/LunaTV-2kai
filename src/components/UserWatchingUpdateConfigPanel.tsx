'use client';

import {
  CheckCircle,
  LoaderCircle,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { validateCronExpression } from '@/lib/scheduler/cron-utils';
import { validateTimezone } from '@/lib/scheduler/timezone-utils';

type UserRole = 'user' | 'admin' | 'owner';
type ConfigMode = 'inherit' | 'custom';
type ConfigField = 'cronExpression' | 'timezone';
type ConfigSource = 'user' | 'system' | 'default';

interface UserWatchingUpdateConfigResponse {
  username: string;
  permission: {
    enabled: boolean;
    allowCustomSchedule: boolean;
    allowTriggerLink: boolean;
  };
  userConfig: {
    cronExpression?: string;
    timezone?: string;
  } | null;
  effective: {
    enabled: boolean;
    cronExpression: string;
    timezone: string;
  };
  sources: {
    cron: ConfigSource;
    timezone: ConfigSource;
  };
  audit?: {
    updatedAt?: number | null;
    operator?: string | null;
  };
}

interface UserWatchingUpdateConfigPanelProps {
  username: string;
  userRole: UserRole;
  systemUpdateCheckEnabled: boolean;
  onRefresh: () => Promise<void>;
}

const CRON_PRESETS = [
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every 1 hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Every 24 hours', value: '0 0 * * *' },
] as const;

const TIMEZONE_PRESETS = [
  'UTC',
  'Asia/Shanghai',
  'Europe/Berlin',
  'Asia/Tokyo',
  'America/New_York',
  'America/Los_Angeles',
] as const;

const SOURCE_LABELS: Record<ConfigSource, string> = {
  user: 'User Config',
  system: 'System Config',
  default: 'Default',
};

async function readResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Watching update config request failed');
  }
  return data as UserWatchingUpdateConfigResponse;
}

export default function UserWatchingUpdateConfigPanel({
  username,
  userRole,
  systemUpdateCheckEnabled,
  onRefresh,
}: UserWatchingUpdateConfigPanelProps) {
  const [config, setConfig] = useState<UserWatchingUpdateConfigResponse | null>(
    null,
  );
  const [permissionEnabled, setPermissionEnabled] = useState(false);
  const [allowCustomSchedule, setAllowCustomSchedule] = useState(true);
  const [allowTriggerLink, setAllowTriggerLink] = useState(false);
  const [cronMode, setCronMode] = useState<ConfigMode>('inherit');
  const [cronExpression, setCronExpression] = useState('*/30 * * * *');
  const [timezoneMode, setTimezoneMode] = useState<ConfigMode>('inherit');
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<
    ConfigField | 'permission' | 'ability' | null
  >(null);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const requestSequence = useRef(0);

  const applyConfig = useCallback(
    (next: UserWatchingUpdateConfigResponse, resetDrafts: boolean) => {
      setConfig(next);
      setPermissionEnabled(next.permission.enabled);
      setAllowCustomSchedule(next.permission.allowCustomSchedule);
      setAllowTriggerLink(next.permission.allowTriggerLink);
      if (!resetDrafts) return;

      setCronMode(
        next.userConfig?.cronExpression === undefined ? 'inherit' : 'custom',
      );
      setCronExpression(
        next.userConfig?.cronExpression ?? next.effective.cronExpression,
      );
      setTimezoneMode(
        next.userConfig?.timezone === undefined ? 'inherit' : 'custom',
      );
      setTimezone(next.userConfig?.timezone ?? next.effective.timezone);
    },
    [],
  );

  const loadConfig = useCallback(
    async (resetDrafts: boolean) => {
      const requestId = ++requestSequence.current;
      try {
        const response = await fetch(
          `/api/admin/watching-updates/users/${encodeURIComponent(username)}/config`,
          { cache: 'no-store' },
        );
        const data = await readResponse(response);
        if (requestId === requestSequence.current) {
          applyConfig(data, resetDrafts);
        }
      } catch (error) {
        if (requestId === requestSequence.current) {
          setMessage({
            type: 'error',
            text:
              error instanceof Error
                ? error.message
                : 'Failed to load watching update config',
          });
        }
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    },
    [applyConfig, username],
  );

  useEffect(() => {
    setLoading(true);
    setMessage(null);
    void loadConfig(true);
  }, [loadConfig]);

  const updateSavedField = (
    next: UserWatchingUpdateConfigResponse,
    field: ConfigField,
  ) => {
    applyConfig(next, false);
    if (field === 'cronExpression') {
      setCronMode(next.userConfig?.cronExpression ? 'custom' : 'inherit');
      setCronExpression(
        next.userConfig?.cronExpression ?? next.effective.cronExpression,
      );
    } else {
      setTimezoneMode(next.userConfig?.timezone ? 'custom' : 'inherit');
      setTimezone(next.userConfig?.timezone ?? next.effective.timezone);
    }
  };

  const saveField = async (field: ConfigField) => {
    const mode = field === 'cronExpression' ? cronMode : timezoneMode;
    let value = '';
    if (mode === 'custom') {
      if (field === 'cronExpression') {
        if (!validateCronExpression(cronExpression)) {
          setMessage({ type: 'error', text: 'Cron Expression is invalid' });
          return;
        }
        value = cronExpression;
      } else {
        if (!validateTimezone(timezone)) {
          setMessage({ type: 'error', text: 'Timezone is invalid' });
          return;
        }
        value = timezone;
      }
    }

    setSaving(field);
    setMessage(null);
    try {
      const response = await fetch(configUrl(username), {
        method: mode === 'custom' ? 'PATCH' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'custom' ? { [field]: value } : { field },
        ),
      });
      const next = await readResponse(response);
      updateSavedField(next, field);
      await onRefresh();
      setMessage({
        type: 'success',
        text: mode === 'custom' ? 'User config saved' : 'Override cleared',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Failed to save watching update config',
      });
    } finally {
      setSaving(null);
    }
  };

  const savePermission = async () => {
    setSaving('permission');
    setMessage(null);
    try {
      const response = await fetch(
        '/api/admin/settings/update-check/permissions',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: username, enabled: permissionEnabled }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update permission');
      }
      await onRefresh();
      await loadConfig(false);
      setMessage({ type: 'success', text: 'Permission saved' });
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Failed to update permission',
      });
    } finally {
      setSaving(null);
    }
  };

  const saveAbilityLimits = async () => {
    setSaving('ability');
    setMessage(null);
    try {
      const response = await fetch(configUrl(username), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowCustomSchedule, allowTriggerLink }),
      });
      const next = await readResponse(response);
      applyConfig(next, false);
      await onRefresh();
      setMessage({ type: 'success', text: 'Ability limits saved' });
    } catch (error) {
      setMessage({
        type: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Failed to save ability limits',
      });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center gap-2 py-8 text-sm text-gray-500 dark:text-gray-400'>
        <LoaderCircle className='h-4 w-4 animate-spin' />
        Loading watching update config
      </div>
    );
  }

  if (!config) {
    return (
      <div className='py-6 text-sm text-red-600 dark:text-red-400'>
        {message?.text || 'Unable to load watching update config'}
      </div>
    );
  }

  const targetIsOwner = userRole === 'owner';
  const displayedPermission = targetIsOwner
    ? systemUpdateCheckEnabled
    : permissionEnabled;

  return (
    <div className='space-y-5'>
      {message && <StatusMessage type={message.type} text={message.text} />}

      <section className='space-y-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <SectionHeading icon='shield' title='Update Permission' />
        <div className='flex flex-wrap items-center justify-between gap-4'>
          <div className='text-sm text-gray-600 dark:text-gray-400'>
            <p>
              Authorization: {displayedPermission ? 'Enabled' : 'Disabled'}
            </p>
            <p>Effective status: {config.effective.enabled ? 'Enabled' : 'Disabled'}</p>
            <p>Updated by: {config.audit?.operator ?? '-'}</p>
          </div>
          <div className='flex items-center gap-3'>
            <Switch
              label='Update-check authorization'
              checked={displayedPermission}
              disabled={targetIsOwner || saving === 'permission'}
              onChange={() => setPermissionEnabled((current) => !current)}
            />
            {!targetIsOwner && (
              <ActionButton
                label='Save Permission'
                loading={saving === 'permission'}
                onClick={savePermission}
              />
            )}
          </div>
        </div>
      </section>

      <section className='space-y-4 border-b border-gray-200 pb-5 dark:border-gray-700'>
        <SectionHeading icon='sliders' title='Ability Limits' />
        <div className='grid gap-3 sm:grid-cols-2'>
          <SwitchRow
            label='Allow user custom schedule'
            description='Controls whether the user can edit Cron and Timezone from the user center.'
            checked={allowCustomSchedule}
            disabled={saving === 'ability'}
            onChange={() => setAllowCustomSchedule((current) => !current)}
          />
          <SwitchRow
            label='Allow Trigger Link'
            description='Controls whether the user can manage Trigger Link later.'
            checked={allowTriggerLink}
            disabled={saving === 'ability'}
            onChange={() => setAllowTriggerLink((current) => !current)}
          />
        </div>
        <ActionButton
          label='Save Ability Limits'
          loading={saving === 'ability'}
          onClick={saveAbilityLimits}
        />
      </section>

      <section className='space-y-0'>
        <SectionHeading icon='sliders' title='User Config Management' />
        <StrategySection
          title='Cron'
          effective={config.effective.cronExpression}
          override={config.userConfig?.cronExpression}
          source={config.sources.cron}
          mode={cronMode}
          onModeChange={setCronMode}
          saving={saving === 'cronExpression'}
          onSave={() => saveField('cronExpression')}
        >
          {cronMode === 'custom' && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='block'>
                <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                  Cron preset
                </span>
                <select
                  aria-label='Cron preset'
                  value={
                    CRON_PRESETS.some(
                      (preset) => preset.value === cronExpression,
                    )
                      ? cronExpression
                      : ''
                  }
                  onChange={(event) => {
                    if (event.target.value) setCronExpression(event.target.value);
                  }}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                >
                  <option value=''>Custom expression</option>
                  {CRON_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className='block'>
                <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                  Cron Expression
                </span>
                <input
                  aria-label='Cron Expression'
                  value={cronExpression}
                  onChange={(event) => setCronExpression(event.target.value)}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </label>
            </div>
          )}
        </StrategySection>

        <StrategySection
          title='Timezone'
          effective={config.effective.timezone}
          override={config.userConfig?.timezone}
          source={config.sources.timezone}
          mode={timezoneMode}
          onModeChange={setTimezoneMode}
          saving={saving === 'timezone'}
          onSave={() => saveField('timezone')}
        >
          {timezoneMode === 'custom' && (
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='block'>
                <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                  Timezone preset
                </span>
                <select
                  aria-label='Timezone preset'
                  value={
                    TIMEZONE_PRESETS.includes(
                      timezone as (typeof TIMEZONE_PRESETS)[number],
                    )
                      ? timezone
                      : ''
                  }
                  onChange={(event) => {
                    if (event.target.value) setTimezone(event.target.value);
                  }}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                >
                  <option value=''>Custom timezone</option>
                  {TIMEZONE_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </label>
              <label className='block'>
                <span className='mb-1 block text-xs text-gray-600 dark:text-gray-400'>
                  IANA Timezone
                </span>
                <input
                  aria-label='IANA Timezone'
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                />
              </label>
            </div>
          )}
        </StrategySection>
      </section>
    </div>
  );
}

function configUrl(username: string) {
  return `/api/admin/watching-updates/users/${encodeURIComponent(username)}/config`;
}

function StatusMessage({
  type,
  text,
}: {
  type: 'success' | 'error';
  text: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        type === 'success'
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
      }`}
    >
      {type === 'success' ? (
        <CheckCircle className='h-4 w-4 shrink-0' />
      ) : (
        <XCircle className='h-4 w-4 shrink-0' />
      )}
      {text}
    </div>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: 'shield' | 'sliders';
  title: string;
}) {
  const Icon = icon === 'shield' ? ShieldCheck : SlidersHorizontal;
  return (
    <div className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
      <Icon className='h-4 w-4 text-blue-600 dark:text-blue-400' />
      {title}
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className='flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700'>
      <div>
        <div className='text-sm font-medium text-gray-900 dark:text-gray-100'>
          {label}
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          {description}
        </p>
      </div>
      <Switch
        label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function StrategySection({
  title,
  effective,
  override,
  source,
  mode,
  onModeChange,
  saving,
  onSave,
  children,
}: {
  title: string;
  effective: string;
  override?: string;
  source: ConfigSource;
  mode: ConfigMode;
  onModeChange: (mode: ConfigMode) => void;
  saving: boolean;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className='space-y-4 border-b border-gray-200 py-5 last:border-b-0 dark:border-gray-700'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h4>
          <div className='mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400'>
            <p>
              Effective:{' '}
              <span className='font-mono text-gray-900 dark:text-gray-100'>
                {effective}
              </span>
            </p>
            <p>
              User config:{' '}
              <span className='font-mono text-gray-900 dark:text-gray-100'>
                {override ?? 'Not set'}
              </span>
            </p>
            <p>
              Source:{' '}
              <span className='font-medium text-blue-700 dark:text-blue-300'>
                {SOURCE_LABELS[source]}
              </span>
            </p>
          </div>
        </div>
        <div
          role='group'
          aria-label={`${title} config mode`}
          className='inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600'
        >
          <button
            type='button'
            aria-pressed={mode === 'inherit'}
            onClick={() => onModeChange('inherit')}
            className={`px-3 py-1.5 text-xs font-medium ${
              mode === 'inherit'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            Inherit system
          </button>
          <button
            type='button'
            aria-pressed={mode === 'custom'}
            onClick={() => onModeChange('custom')}
            className={`border-l border-gray-300 px-3 py-1.5 text-xs font-medium dark:border-gray-600 ${
              mode === 'custom'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            Custom
          </button>
        </div>
      </div>
      {children}
      <ActionButton
        label={mode === 'custom' ? `Save ${title}` : `Clear ${title} Override`}
        loading={saving}
        onClick={onSave}
      />
    </section>
  );
}

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function ActionButton({
  label,
  loading,
  onClick,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={loading}
      onClick={onClick}
      className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60'
    >
      {loading ? (
        <LoaderCircle className='h-4 w-4 animate-spin' />
      ) : (
        <Save className='h-4 w-4' />
      )}
      {loading ? 'Saving...' : label}
    </button>
  );
}
