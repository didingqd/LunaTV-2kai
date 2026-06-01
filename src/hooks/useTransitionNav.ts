'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useCallback } from 'react';

import { shouldUseBrowserAssignNavigation } from '@/lib/browser-navigation';

/**
 * useTransitionNav - Hook for non-blocking navigation
 *
 * Uses React 18's startTransition to mark navigation as low-priority,
 * keeping the UI responsive during route changes.
 *
 * @example
 * ```tsx
 * const navigateWithTransition = useTransitionNav();
 *
 * <button onClick={() => navigateWithTransition('/page')}>
 *   Navigate
 * </button>
 * ```
 */
export function useTransitionNav() {
  const router = useRouter();

  const navigate = useCallback(
    (href: string) => {
      // 修改点：统一过渡导航也遵循“浏览器直跳”本地设置，尽量扩大常用站内跳转覆盖范围
      if (shouldUseBrowserAssignNavigation({ href })) {
        window.location.assign(href);
        return;
      }

      startTransition(() => {
        router.push(href);
      });
    },
    [router]
  );

  return navigate;
}
