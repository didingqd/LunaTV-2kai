'use client';

import { type MouseEvent as ReactMouseEvent } from 'react';

export const BROWSER_NAVIGATION_PREFERENCE_KEY = 'preferLocationAssignNavigation';

export function isBrowserAssignNavigationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const storedPreference = localStorage.getItem(
      BROWSER_NAVIGATION_PREFERENCE_KEY
    );

    // 修改点：当用户尚未写入本地偏好时，回退到后台站点配置注入的默认值
    if (storedPreference === null) {
      return (window as typeof window & {
        RUNTIME_CONFIG?: { PREFER_BROWSER_NAVIGATION?: boolean };
      }).RUNTIME_CONFIG?.PREFER_BROWSER_NAVIGATION === true;
    }

    return JSON.parse(storedPreference) === true;
  } catch {
    return false;
  }
}

export function isExternalNavigationHref(href: string): boolean {
  return /^https?:\/\//.test(href);
}

export function shouldUseBrowserAssignNavigation(options: {
  href: string;
  target?: string;
  event?: Pick<
    ReactMouseEvent<HTMLElement>,
    'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
  >;
  forceRefresh?: boolean;
}): boolean {
  const { href, target, event, forceRefresh = false } = options;

  if (forceRefresh) {
    return true;
  }

  if (!isBrowserAssignNavigationEnabled()) {
    return false;
  }

  if (!href || isExternalNavigationHref(href)) {
    return false;
  }

  if (target === '_blank') {
    return false;
  }

  if (event) {
    const isModifiedClick =
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey;

    if (isModifiedClick) {
      return false;
    }
  }

  return true;
}

export function navigateWithBrowserPreference(options: {
  href: string;
  routerPush?: (href: string) => void;
  forceRefresh?: boolean;
}): void {
  const { href, routerPush, forceRefresh = false } = options;

  // 修改点：统一站内前进型跳转策略，按本地设置决定走浏览器直跳还是保留 SPA 跳转
  if (shouldUseBrowserAssignNavigation({ href, forceRefresh })) {
    window.location.assign(href);
    return;
  }

  routerPush?.(href);
}
