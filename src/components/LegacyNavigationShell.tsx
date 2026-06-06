'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import { isStandaloneRoute } from './navigation-routes';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface LegacyNavigationShellProps {
  children: React.ReactNode;
}

export default function LegacyNavigationShell({ children }: LegacyNavigationShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isStandalone = isStandaloneRoute(pathname);
  const queryString = searchParams.toString();
  const activePath = queryString ? `${pathname}?${queryString}` : pathname;
  const showBackButton = pathname === '/play' || pathname.startsWith('/play/') || pathname === '/live';

  if (isStandalone) {
    // 修改点：独立路由在竖向布局下仍不显示任何导航，保持登录/注册等页面干净
    return (
      <main className='w-full min-h-screen'>
        <div className='w-full max-w-[2560px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20'>
          {children}
        </div>
      </main>
    );
  }

  return (
    <div className='w-full min-h-screen' translate='no'>
      {/* 修改点：竖向布局复用原始移动端顶部栏，避免和现代顶部导航同时显示 */}
      <MobileHeader showBackButton={showBackButton} />

      <div className='flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        <div className='relative min-w-0 flex-1 transition-all duration-300'>
          {showBackButton && (
            <div className='absolute top-3 left-1 z-20 hidden md:flex'>
              <BackButton />
            </div>
          )}

          <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
            <ThemeToggle />
            <UserMenu />
          </div>

          <main
            className='flex-1 md:min-h-0 mb-14 md:mb-0 md:mt-0 mt-12'
            style={{
              // 修改点：竖向布局由自身预留移动端底部导航与安全区空间，不叠加现代布局 padding
              paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
            }}
          >
            <div className='w-full max-w-[2560px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20'>
              {children}
            </div>
          </main>
        </div>
      </div>

      <div className='md:hidden'>
        <MobileBottomNav activePath={activePath} />
      </div>
    </div>
  );
}
