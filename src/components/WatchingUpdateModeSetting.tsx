'use client';

import {
  AlertTriangle,
  Check,
  CircleCheck,
  CloudCog,
  Laptop,
  LoaderCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  readWatchingUpdateSourceMode,
  subscribeWatchingUpdateSourceMode,
  writeWatchingUpdateSourceMode,
  type WatchingUpdateSourceMode,
} from '@/lib/watching-update-preference';
import {
  watchingUpdatesService,
  type WatchingUpdatesModeResolution,
} from '@/lib/watching-updates-service';

type CapabilityDisplayState =
  | 'local'
  | 'checking'
  | 'available'
  | 'unavailable'
  | 'error';

interface CapabilityDisplay {
  state: CapabilityDisplayState;
  message: string;
}

const MODE_OPTIONS: Array<{
  mode: WatchingUpdateSourceMode;
  title: string;
  description: string;
  icon: typeof Laptop;
}> = [
  {
    mode: 'local',
    title: '本地计算',
    description: '由浏览器检测资源更新。',
    icon: Laptop,
  },
  {
    mode: 'backend',
    title: '后端获取 + 本地核验',
    description: '优先读取服务器结果，并在后台校验资源。',
    icon: CloudCog,
  },
];

const LOCAL_DISPLAY: CapabilityDisplay = {
  state: 'local',
  message: '当前使用本地计算。',
};

export function WatchingUpdateModeSetting() {
  const sourceMode = useSyncExternalStore(
    subscribeWatchingUpdateSourceMode,
    readWatchingUpdateSourceMode,
    (): WatchingUpdateSourceMode => 'local',
  );
  const [capabilityDisplay, setCapabilityDisplay] =
    useState<CapabilityDisplay>(LOCAL_DISPLAY);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (sourceMode === 'local') {
      requestIdRef.current += 1;
      setCapabilityDisplay(LOCAL_DISPLAY);
      return;
    }

    const requestId = ++requestIdRef.current;
    setCapabilityDisplay({
      state: 'checking',
      message: '正在确认当前账号的后端计算权限...',
    });
    void watchingUpdatesService.resolveMode('backend').then((resolution) => {
      if (requestIdRef.current !== requestId) return;
      setCapabilityDisplay(describeCapability(resolution));
    });
    return () => {
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [sourceMode]);

  return (
    <section className='space-y-3' aria-labelledby='watching-update-mode-title'>
      <div>
        <h4
          id='watching-update-mode-title'
          className='text-sm font-medium text-gray-700 dark:text-gray-300'
        >
          追更更新获取
        </h4>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          选择追更列表的更新计算方式
        </p>
      </div>

      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2' role='radiogroup'>
        {MODE_OPTIONS.map((option) => {
          const selected = sourceMode === option.mode;
          const Icon = option.icon;
          return (
            <button
              key={option.mode}
              type='button'
              role='radio'
              aria-checked={selected}
              onClick={() => writeWatchingUpdateSourceMode(option.mode)}
              className={`flex min-h-24 w-full items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors sm:min-h-28 ${
                selected
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                  : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'
              }`}
            >
              <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'>
                <Icon className='h-5 w-5' />
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block text-sm font-medium text-gray-900 dark:text-gray-100'>
                  {option.title}
                </span>
                <span className='mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400'>
                  {option.description}
                </span>
              </span>
              <Check
                className={`h-5 w-5 shrink-0 ${selected ? 'text-green-600 dark:text-green-400' : 'text-transparent'}`}
                aria-hidden='true'
              />
            </button>
          );
        })}
      </div>

      <CapabilityStatus display={capabilityDisplay} />
    </section>
  );
}

function CapabilityStatus({ display }: { display: CapabilityDisplay }) {
  const available = display.state === 'available';
  const checking = display.state === 'checking';
  const Icon = available
    ? CircleCheck
    : checking
      ? LoaderCircle
      : display.state === 'local'
        ? Laptop
        : AlertTriangle;
  const color = available
    ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
    : display.state === 'local'
      ? 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300';

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5 ${color}`}
      role='status'
      aria-live='polite'
    >
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${checking ? 'animate-spin' : ''}`}
      />
      <span>{display.message}</span>
    </div>
  );
}

function describeCapability(
  resolution: WatchingUpdatesModeResolution,
): CapabilityDisplay {
  if (resolution.effectiveMode === 'backend') {
    return {
      state: 'available',
      message: '当前账号可以使用后端追更计算，已启用后端结果优先。',
    };
  }
  if (resolution.capabilityState === 'error') {
    return {
      state: 'error',
      message: '无法确认后端计算能力，当前将继续使用本地计算。',
    };
  }

  const capability = resolution.capability;
  if (capability?.supported === false) {
    return {
      state: 'unavailable',
      message: '当前部署未提供后端追更计算，将继续使用本地计算。',
    };
  }
  if (capability?.enabled === false) {
    return {
      state: 'unavailable',
      message: '管理员尚未开启后端追更计算，将继续使用本地计算。',
    };
  }
  if (capability?.userAllowed === false) {
    return {
      state: 'unavailable',
      message: '当前账号未获后端追更计算授权，将继续使用本地计算。',
    };
  }
  return {
    state: 'unavailable',
    message: '当前账号暂时无法使用后端追更计算，将继续使用本地计算。',
  };
}
