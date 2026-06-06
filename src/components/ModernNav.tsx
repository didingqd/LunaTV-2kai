/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Cat, Clover, Film, FolderOpen, Globe, Home, MoreHorizontal, PlaySquare, Radio, Search, Sparkles, Star, Tv, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, queryOptions } from '@tanstack/react-query';

import { FastLink } from './FastLink';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { useSite } from './SiteProvider';

interface NavItem {
  id: string;
  icon: any;
  label: string;
  href: string;
  color: string;
  gradient: string;
}

type NavMenuKey = 'source-browser' | 'movie' | 'tv' | 'shortdrama' | 'anime' | 'show';

const FIXED_CATEGORY_MENU_KEYS: NavMenuKey[] = ['source-browser', 'movie', 'tv', 'shortdrama', 'anime', 'show'];

const BASE_MENU_ITEMS: NavItem[] = [
  {
    id: 'home',
    icon: Home,
    label: '首页',
    href: '/',
    color: 'text-green-500',
    gradient: 'from-green-500 to-emerald-500',
  },
  {
    id: 'search',
    icon: Search,
    label: '搜索',
    href: '/search',
    color: 'text-blue-500',
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    id: 'source-browser',
    icon: Globe,
    label: '源浏览器',
    href: '/source-browser',
    color: 'text-emerald-500',
    gradient: 'from-emerald-500 to-green-500',
  },
  {
    id: 'movie',
    icon: Film,
    label: '电影',
    href: '/douban?type=movie',
    color: 'text-red-500',
    gradient: 'from-red-500 to-pink-500',
  },
  {
    id: 'tv',
    icon: Tv,
    label: '剧集',
    href: '/douban?type=tv',
    color: 'text-blue-600',
    gradient: 'from-blue-600 to-indigo-600',
  },
  {
    id: 'shortdrama',
    icon: PlaySquare,
    label: '短剧',
    href: '/shortdrama',
    color: 'text-purple-500',
    gradient: 'from-purple-500 to-violet-500',
  },
  {
    id: 'anime',
    icon: Cat,
    label: '动漫',
    href: '/douban?type=anime',
    color: 'text-pink-500',
    gradient: 'from-pink-500 to-rose-500',
  },
  {
    id: 'show',
    icon: Clover,
    label: '综艺',
    href: '/douban?type=show',
    color: 'text-orange-500',
    gradient: 'from-orange-500 to-amber-500',
  },
];

interface ModernNavProps {
  showAIButton?: boolean;
  onAIButtonClick?: () => void;
  showDesktopNav?: boolean;
  showMobileNav?: boolean;
  showSpacer?: boolean;
}

// Query Options 工厂函数
const userEmbyConfigOptions = () => queryOptions({
  queryKey: ['user', 'emby-config'],
  queryFn: async () => {
    const res = await fetch('/api/user/emby-config');
    if (!res.ok) return null;
    const data = await res.json();
    return data.config;
  },
  staleTime: 5 * 60 * 1000,
  retry: false,
});

const publicSourcesOptions = () => queryOptions({
  queryKey: ['emby', 'public-sources'],
  queryFn: async () => {
    const res = await fetch('/api/emby/public-sources');
    if (!res.ok) return { sources: [] };
    return res.json();
  },
  staleTime: 5 * 60 * 1000,
  retry: false,
});

export default function ModernNav({
  showAIButton = false,
  onAIButtonClick,
  showDesktopNav = true,
  showMobileNav = true,
  showSpacer = true,
}: ModernNavProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(pathname);
  const { siteName } = useSite();
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // 检查用户是否配置了 Emby
  const { data: userEmbyConfig } = useQuery(userEmbyConfigOptions());

  // 检查管理员是否设置了公共源
  const { data: publicSourcesData } = useQuery(publicSourcesOptions());

  const menuItems = useMemo(() => {
    const runtimeConfig = typeof window !== 'undefined' ? (window as any).RUNTIME_CONFIG : null;
    const hiddenItems = (runtimeConfig?.NAV_MENU_HIDDEN_ITEMS ?? []) as string[];

    // 修改点：根据后台隐藏列表过滤固定菜单项，源浏览器与影视分类都可在后台分类配置中控制显隐
    const newItems = BASE_MENU_ITEMS.filter((item) => {
      if (!FIXED_CATEGORY_MENU_KEYS.includes(item.id as NavMenuKey)) return true;
      return !hiddenItems.includes(item.id);
    });

    // 直播 - 根据 ENABLE_WEB_LIVE 动态控制
    if (runtimeConfig?.ENABLE_WEB_LIVE) {
      newItems.push({
        id: 'live',
        icon: Radio,
        label: '直播',
        href: '/live',
        color: 'text-teal-500',
        gradient: 'from-teal-500 to-cyan-500',
      });
    }

    // 修改点：自定义入口仍沿用启用自定义分类数量判断，不受固定菜单隐藏列表影响
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      newItems.push({
        id: 'custom',
        icon: Star,
        label: '自定义',
        href: '/douban?type=custom',
        color: 'text-yellow-500',
        gradient: 'from-yellow-500 to-amber-500',
      });
    }

    // Emby - 用户有私人源 OR 管理员有公共源，都显示导航
    const hasUserEmby = userEmbyConfig?.sources?.some((s: any) => s.enabled && s.ServerURL);
    const hasPublicEmby = (publicSourcesData?.sources?.length ?? 0) > 0;
    if (hasUserEmby || hasPublicEmby) {
      newItems.push({
        id: 'emby',
        icon: FolderOpen,
        label: 'Emby',
        href: '/emby',
        color: 'text-indigo-500',
        gradient: 'from-indigo-500 to-purple-500',
      });
    }

    return newItems;
  }, [userEmbyConfig, publicSourcesData]);

  useEffect(() => {
    const queryString = searchParams.toString();
    const fullPath = queryString ? `${pathname}?${queryString}` : pathname;
    setActive(fullPath);
  }, [pathname, searchParams]);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];
    const decodedActive = decodeURIComponent(active);
    const decodedHref = decodeURIComponent(href);

    return (
      decodedActive === decodedHref ||
      (decodedActive.startsWith('/douban') &&
        typeMatch &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <>
      {showDesktopNav && (
        <nav className='hidden md:block fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50'>
        <div className='max-w-[2560px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-20'>
          <div className='flex items-center justify-between h-16 gap-4'>
            {/* Logo */}
            <FastLink href='/' className='shrink-0'>
              <div className='text-xl font-bold bg-linear-to-r from-green-600 via-emerald-600 to-teal-600 dark:from-green-400 dark:via-emerald-400 dark:to-teal-400 bg-clip-text text-transparent'>
                {siteName}
              </div>
            </FastLink>

            {/* Navigation Items */}
            <div className='flex items-center justify-center gap-1 lg:gap-2 overflow-x-auto scrollbar-hide flex-1 px-4'>
              {menuItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);

              return (
                <FastLink
                  key={item.id}
                  href={item.href}
                  useTransitionNav
                  onClick={() => setActive(item.href)}
                  className='group relative flex items-center gap-2 px-3 lg:px-4 py-2 rounded-full transition-all duration-300 hover:bg-gray-100/50 dark:hover:bg-gray-800/50 whitespace-nowrap shrink-0'
                >
                  {/* Active indicator */}
                  {active && (
                    <div
                      className={`absolute inset-0 bg-linear-to-r ${item.gradient} opacity-10 rounded-full animate-pulse`}
                    />
                  )}

                  {/* Icon */}
                  <div className='relative'>
                    <Icon
                      className={`w-5 h-5 transition-all duration-300 ${
                        active
                          ? item.color
                          : 'text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200'
                      } ${active ? 'scale-110' : 'group-hover:scale-110'}`}
                    />
                  </div>

                  {/* Label */}
                  <span
                    className={`text-sm font-medium transition-all duration-300 ${
                      active
                        ? `${item.color} font-semibold`
                        : 'text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100'
                    }`}
                  >
                    {item.label}
                  </span>

                  {/* Bottom active border */}
                  {active && (
                    <div
                      className={`absolute bottom-0 left-0 right-0 h-0.5 bg-linear-to-r ${item.gradient} rounded-full`}
                    />
                  )}
                </FastLink>
              );
            })}
            </div>

            {/* Right Side Actions - ✨ AI Button, Theme Toggle & User Menu */}
            <div className='flex items-center gap-2 shrink-0'>
              {showAIButton && onAIButtonClick && (
                <button
                  onClick={onAIButtonClick}
                  className='relative p-2 rounded-lg bg-linear-to-br from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 active:scale-95 transition-all duration-200 shadow-lg shadow-blue-500/30 group'
                  aria-label='AI 推荐'
                >
                  <Sparkles className='h-5 w-5 group-hover:scale-110 transition-transform duration-300' />
                </button>
              )}
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </div>
        </nav>
      )}

      {/* More Menu Modal - Render outside nav to avoid z-index issues */}
      {showMobileNav && showMoreMenu && (
        <div
          className='md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm'
          style={{ zIndex: 2147483647 }}
          onClick={() => setShowMoreMenu(false)}
        >
          <div
            className='absolute bottom-20 left-2 right-2 bg-white/90 dark:bg-gray-900/90 backdrop-blur-3xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-800/30 overflow-hidden'
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200/50 dark:border-gray-700/50'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>全部分类</h3>
              <button
                onClick={() => setShowMoreMenu(false)}
                className='p-2 rounded-full hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors'
              >
                <X className='w-5 h-5 text-gray-600 dark:text-gray-400' />
              </button>
            </div>

            {/* All menu items in grid */}
            <div className='grid grid-cols-4 gap-4 p-4'>
              {menuItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);

                return (
                  <FastLink
                    key={item.id}
                    href={item.href}
                    useTransitionNav
                    onClick={() => {
                      setActive(item.href);
                      setShowMoreMenu(false);
                    }}
                    className='flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-300 active:scale-95 hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                  >
                    <div
                      className={`flex items-center justify-center w-12 h-12 rounded-2xl ${
                        active
                          ? `bg-linear-to-br ${item.gradient}`
                          : 'bg-gray-100 dark:bg-gray-800'
                      }`}
                    >
                      <Icon
                        className={`w-6 h-6 ${
                          active
                            ? 'text-white'
                            : 'text-gray-600 dark:text-gray-400'
                        }`}
                      />
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        active
                          ? item.color
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {item.label}
                    </span>
                  </FastLink>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation - Netflix Full-Width Style with Light Mode Support */}
      {showMobileNav && (
        <nav
          className='md:hidden fixed left-0 right-0 z-40 bg-white/80 dark:bg-black/95 backdrop-blur-lg border-t border-black/5 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-2xl dark:shadow-black/40'
          style={{
            bottom: 0,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
        <div className='flex items-center justify-around px-2 py-2'>
          {/* Show first 4 items + More button */}
          {menuItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            return (
              <FastLink
                key={item.id}
                href={item.href}
                useTransitionNav
                onClick={() => setActive(item.href)}
                className='flex flex-col items-center justify-center min-w-[60px] flex-1 py-2 px-1 transition-all duration-200 active:scale-95'
              >
                <Icon
                  className={`w-6 h-6 mb-1 transition-colors duration-200 ${
                    active ? item.color : 'text-gray-600 dark:text-gray-400'
                  }`}
                />
                <span
                  className={`text-[10px] font-medium transition-colors duration-200 ${
                    active ? item.color : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {item.label}
                </span>
              </FastLink>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setShowMoreMenu(true)}
            className='flex flex-col items-center justify-center min-w-[60px] flex-1 py-2 px-1 transition-all duration-200 active:scale-95'
          >
            <MoreHorizontal className='w-6 h-6 mb-1 text-gray-600 dark:text-gray-400' />
            <span className='text-[10px] font-medium text-gray-600 dark:text-gray-400'>更多</span>
          </button>
        </div>
        </nav>
      )}

      {/* Spacer for fixed navigation */}
      {showSpacer && <div className='hidden md:block h-16' />}
      {showSpacer && <div className='md:hidden h-20' />}
    </>
  );
}
