'use client';

import { Sparkles } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { isAIRecommendFeatureDisabled } from '@/lib/ai-recommend.client';

import AIRecommendModal from './AIRecommendModal';
import { BackButton } from './BackButton';
import NavigationShell from './NavigationShell';
import { isStandaloneRoute } from './navigation-routes';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface LegacyNavigationShellProps {
  children: React.ReactNode;
}

function detectMobileDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  // 修改点：竖向布局在真实移动设备上始终复用横向布局，避免全屏横屏触发 md 断点后显示桌面侧边栏
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.matchMedia('(pointer: coarse)').matches
  );
}

export default function LegacyNavigationShell({ children }: LegacyNavigationShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isStandalone = isStandaloneRoute(pathname);
  const queryString = searchParams.toString();
  const activePath = queryString ? `${pathname}?${queryString}` : pathname;
  const showBackButton = pathname === '/play' || pathname.startsWith('/play/') || pathname === '/live';
  const [isMobileDevice, setIsMobileDevice] = useState(() => detectMobileDevice());
  const [showAIRecommendModal, setShowAIRecommendModal] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(true);

  useEffect(() => {
    const disabled = isAIRecommendFeatureDisabled();
    setAiEnabled(!disabled);
  }, []);

  useEffect(() => {
    const refreshMobileDevice = () => setIsMobileDevice(detectMobileDevice());
    window.addEventListener('resize', refreshMobileDevice);
    document.addEventListener('fullscreenchange', refreshMobileDevice);
    return () => {
      window.removeEventListener('resize', refreshMobileDevice);
      document.removeEventListener('fullscreenchange', refreshMobileDevice);
    };
  }, []);

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

  if (isMobileDevice) {
    // 修改点：真实手机端不再区分横向/竖向配置，直接复用横向布局的小屏 UI 与内容容器
    return (
      <>
        <NavigationShell
          showDesktopNav={false}
          showMobileNav
          showSpacer={false}
          forceMobileLayout
        />
        <main className='w-full min-h-screen pt-[44px] md:pt-16 pb-16 md:pb-8'>
          <div className='w-full max-w-[2560px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20'>
            {children}
          </div>
        </main>
      </>
    );
  }

  return (
    <div className='w-full min-h-screen' translate='no'>
      <div className='hidden md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
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
            {/* 修改点：竖向布局电脑端 AI 按钮放在右上角，与横向布局位置保持一致 */}
            {aiEnabled && (
              <button
                type='button'
                onClick={() => setShowAIRecommendModal(true)}
                className='relative p-2 rounded-lg bg-linear-to-br from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 active:scale-95 transition-all duration-200 shadow-lg shadow-blue-500/30 group'
                aria-label='AI 推荐'
              >
                <Sparkles className='h-5 w-5 group-hover:scale-110 transition-transform duration-300' />
              </button>
            )}
            <ThemeToggle />
            <UserMenu />
          </div>

          <main
            className='flex-1 md:min-h-0 md:pt-[28px] md:mb-0 md:mt-0'
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

      <AIRecommendModal
        isOpen={showAIRecommendModal}
        onClose={() => setShowAIRecommendModal(false)}
      />
    </div>
  );
}
