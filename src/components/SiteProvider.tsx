'use client';

import { createContext, ReactNode, useContext } from 'react';

interface SiteContextValue {
  siteName: string;
  announcement?: string;
  userNotification?: string;
}

const DEFAULT_ANNOUNCEMENT =
  '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

const SiteContext = createContext<SiteContextValue>({
  siteName: 'MoonTV',
  announcement: DEFAULT_ANNOUNCEMENT,
  userNotification: '',
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName,
  announcement,
  userNotification,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
  userNotification?: string;
}) {
  return (
    <SiteContext.Provider value={{ siteName, announcement, userNotification }}>
      {children}
    </SiteContext.Provider>
  );
}
