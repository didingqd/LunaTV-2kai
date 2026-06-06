'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
  showAIButton?: boolean;
  onAIButtonClick?: () => void;
}

const MobileHeader = ({
  showBackButton = false,
  showAIButton = false,
  onAIButtonClick,
}: MobileHeaderProps) => {
  const { siteName } = useSite();
  return (
    <header className='md:hidden fixed top-0 left-0 right-0 z-999 w-full bg-white/90 backdrop-blur-md border-b border-gray-200/50 shadow-sm dark:bg-gray-900/90 dark:border-gray-700/50'>
      <div className='h-12 flex items-center justify-between px-4'>
        {/* 左侧：搜索按钮、返回按钮和设置按钮 */}
        <div className='flex items-center gap-2'>
          <Link
            href='/search'
            className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50 transition-colors'
          >
            <svg
              className='w-full h-full'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
              />
            </svg>
          </Link>
          {/* 修改点：竖向布局移动端 AI 推荐按钮放在搜索按钮旁边，避免占用右侧用户操作区 */}
          {showAIButton && onAIButtonClick && (
            <button
              type='button'
              onClick={onAIButtonClick}
              className='w-10 h-10 p-2 rounded-full flex items-center justify-center bg-linear-to-br from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 active:scale-95 transition-all duration-200 shadow-md shadow-blue-500/25'
              aria-label='AI 推荐'
            >
              <Sparkles className='w-full h-full' />
            </button>
          )}
          {showBackButton && <BackButton />}
        </div>

        {/* 右侧按钮 */}
        <div className='flex items-center gap-2'>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>

      {/* 中间：Logo（绝对居中） */}
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link
          href='/'
          className='text-2xl font-bold text-green-600 tracking-tight hover:opacity-80 transition-opacity'
        >
          {siteName}
        </Link>
      </div>
    </header>
  );
};

export default MobileHeader;
