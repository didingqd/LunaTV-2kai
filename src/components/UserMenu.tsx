/* eslint-disable no-console */

'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
  BarChart3,
  Bell,
  Calendar,
  Download,
  Heart,
  KeyRound,
  ListChecks,
  LogOut,
  PlayCircle,
  Settings,
  Shield,
  Tv,
  User,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { watchingFollowKey } from '@/lib/api/watching-follow';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { navigateWithBrowserPreference } from '@/lib/browser-navigation';
import {
  compareContentIdentity,
  resolveContentIdentity,
} from '@/lib/content-identity';
import {
  continueWatchingSortLabel,
  sortContinueWatchingRecords,
} from '@/lib/continue-watching-sort';
import type { PlayRecord } from '@/lib/types';
import { getUserMenuIndicatorColor } from '@/lib/user-menu-indicator';
import { CURRENT_VERSION } from '@/lib/version';
import { UpdateStatus } from '@/lib/version_check';
import { WATCHING_UPDATES_QUERY_ROOT } from '@/lib/watching-updates-cache';
// 🚀 修改点：继续观看排序（与 APP 同款），弹窗与主页共享同一偏好
import { useContinueWatchingSortSelection } from '@/hooks/useContinueWatchingSortSelection';
import { useSourcesQuery } from '@/hooks/useSourcesQuery';
import {
  useChangePasswordMutation,
  useFavoritesQuery,
  useInvalidateUserMenuData,
  usePlayRecordsQuery,
  useServerConfigQuery,
  useVersionCheckQuery,
  useWatchRoomConfigQuery,
} from '@/hooks/useUserMenuQueries';
import {
  getWatchingFollowBaselineMenuState,
  useWatchingFollows,
} from '@/hooks/useWatchingFollows';
import {
  useRefreshWatchingUpdates,
  useWatchingUpdatesQuery,
} from '@/hooks/useWatchingUpdates';

import { useDownload } from '@/contexts/DownloadContext';

// 🚀 修改点：继续观看排序（与 APP 同款），弹窗与主页共享同一偏好
import ContinueWatchingSortPanel from './ContinueWatchingSortPanel';
import {
  MOBILE_DIALOG_CONTENT_CLASS,
  MOBILE_DIALOG_FRAME_CLASS,
  MOBILE_DIALOG_HEADER_CLASS,
} from './mobile-dialog-layout';
import NotificationCenterPage from './NotificationCenterPage';
import NotificationSettingsPage from './NotificationSettingsPage';
import { SettingsPanel } from './SettingsPanel';
import { VersionPanel } from './VersionPanel';
import VideoCard from './VideoCard';
import {
  WATCHING_UPDATE_CARD_CONTENT_CLASS,
  WATCHING_UPDATE_CARD_GRID_CLASS,
  WATCHING_UPDATE_CARD_SHELL_CLASS,
  WATCHING_UPDATE_EMPTY_DETAIL_CLASS,
  WATCHING_UPDATE_EMPTY_STATE_CLASS,
  WATCHING_UPDATE_EMPTY_TITLE_CLASS,
  WATCHING_UPDATE_FOOTNOTE_CLASS,
  WATCHING_UPDATE_SECTION_CLASS,
  WATCHING_UPDATE_SECTION_COUNT_CLASS,
  WATCHING_UPDATE_SECTION_HEADER_CLASS,
  WATCHING_UPDATE_SECTION_TITLE_CLASS,
} from './watching-update-card-ui';
import WatchingUpdateSettingsPage from './WatchingUpdateSettingsPage';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

const USER_NOTIFICATIONS_ENDPOINT = '/api/user/notifications';

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [isWatchingUpdatesOpen, setIsWatchingUpdatesOpen] = useState(false);
  const [isContinueWatchingOpen, setIsContinueWatchingOpen] = useState(false);
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [watchingUpdatesTab, setWatchingUpdatesTab] = useState<
    'updates' | 'follows' | 'settings'
  >('updates');
  const [notificationsTab, setNotificationsTab] = useState<'list' | 'settings'>(
    'list',
  );
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [notificationUnread, setNotificationUnread] = useState(0);
  const [storageType] = useState<string>(() => {
    // 🔧 优化：直接从 RUNTIME_CONFIG 读取初始值，避免默认值导致的多次渲染
    // 修改点：移除未使用的 setStorageType（eslint unused-vars）
    if (typeof window !== 'undefined') {
      return (window as any).RUNTIME_CONFIG?.STORAGE_TYPE || 'localstorage';
    }
    return 'localstorage';
  });
  const [mounted, setMounted] = useState(false);
  const [dismissedReleases, setDismissedReleases] = useState<Set<string>>(
    () => {
      // 从localStorage加载已忽略的新上映列表
      if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem('moontv_dismissed_releases');
          return saved ? new Set(JSON.parse(saved)) : new Set();
        } catch {
          return new Set();
        }
      }
      return new Set();
    },
  );

  // 🚀 TanStack Query - 追番更新
  const showWatchingUpdates =
    authInfo?.username && storageType !== 'localstorage';
  const { data: watchingUpdates } = useWatchingUpdatesQuery({
    enabled: showWatchingUpdates, // 页面加载时就检查（会使用缓存）
  });
  const refreshWatchingUpdates = useRefreshWatchingUpdates();

  // 检查是否有实际更新（用于显示红点）- 包括新剧集更新和新上映
  // 过滤掉已忽略的新上映
  const hasActualUpdates =
    watchingUpdates &&
    ((watchingUpdates.updatedCount || 0) > 0 ||
      watchingUpdates.updatedSeries.filter(
        (series) =>
          series.hasNewRelease &&
          !dismissedReleases.has(`${series.sourceKey}+${series.videoId}`),
      ).length > 0);

  // 计算更新数量（新剧集更新 + 未忽略的新上映）
  const totalUpdates =
    (watchingUpdates?.updatedCount || 0) +
    (watchingUpdates?.updatedSeries.filter(
      (series) =>
        series.hasNewRelease &&
        !dismissedReleases.has(`${series.sourceKey}+${series.videoId}`),
    ).length || 0);

  // 🚀 TanStack Query - 版本检查
  const { data: updateStatus = null, isLoading: isChecking } =
    useVersionCheckQuery();

  // 🔧 修改点：按优先级区分用户菜单右上角提示点颜色，版本更新优先黄点，仅提醒更新时显示红点
  const userMenuIndicatorColor = getUserMenuIndicatorColor({
    hasActualUpdates: Boolean(hasActualUpdates && totalUpdates > 0),
    updateStatus,
  });

  // 🚀 TanStack Query - 观影室配置
  const { data: showWatchRoom = false } = useWatchRoomConfigQuery();
  // 🚀 TanStack Query - 下载功能配置
  const { data: serverConfig } = useServerConfigQuery();
  const downloadEnabled = serverConfig?.downloadEnabled ?? true;
  const { tasks, setShowDownloadPanel } = useDownload();

  // 🚀 TanStack Query - 数据失效工具
  // 修改点：移除未使用的 invalidatePlayRecords 解构（eslint unused-vars）
  useInvalidateUserMenuData();

  // Body 滚动锁定 - 使用 overflow 方式避免布局问题
  useEffect(() => {
    if (
      isSettingsOpen ||
      isChangePasswordOpen ||
      isWatchingUpdatesOpen ||
      isContinueWatchingOpen ||
      isFavoritesOpen ||
      isNotificationsOpen
    ) {
      const body = document.body;
      const html = document.documentElement;

      // 保存原始样式
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;

      // 只设置 overflow 来阻止滚动
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';

      return () => {
        // 恢复所有原始样式
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [
    isSettingsOpen,
    isChangePasswordOpen,
    isWatchingUpdatesOpen,
    isContinueWatchingOpen,
    isFavoritesOpen,
    isNotificationsOpen,
  ]);

  // 数据查询条件（从 localStorage 读初始值，供 playRecords query 用）
  const [continueWatchingMinProgress] = useState(() =>
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('continueWatchingMinProgress')) || 5
      : 5,
  );
  const [continueWatchingMaxProgress] = useState(() =>
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('continueWatchingMaxProgress')) || 100
      : 100,
  );
  const [enableContinueWatchingFilter] = useState(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('enableContinueWatchingFilter') === 'true'
      : false,
  );

  // 修改密码相关状态
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // 数据查询条件
  const dataQueryEnabled =
    typeof window !== 'undefined' &&
    !!authInfo?.username &&
    storageType !== 'localstorage';

  // 🚀 TanStack Query - 播放记录
  const { data: playRecords = [], refetch: refetchPlayRecords } =
    usePlayRecordsQuery({
      enabled: dataQueryEnabled,
      enableFilter: enableContinueWatchingFilter,
      minProgress: continueWatchingMinProgress,
      maxProgress: continueWatchingMaxProgress,
    });

  // 🚀 修改点：继续观看排序（与 APP 同款）
  // 弹窗与主页共享同一排序偏好；这里在组件内排序后再截取前 12 条，
  // 保证排序能决定「哪 12 条」进入弹窗（原先是在 query 内先截 12 条再无排序）。
  const [isContinueWatchingSortOpen, setIsContinueWatchingSortOpen] =
    useState(false);
  const {
    selection: continueWatchingSortSelection,
    selectType: selectContinueWatchingSortType,
  } = useContinueWatchingSortSelection();
  const continueWatchingRecords = useMemo(
    () =>
      sortContinueWatchingRecords(
        playRecords,
        continueWatchingSortSelection,
        watchingUpdates?.updatedSeries,
      ).slice(0, 12),
    [playRecords, continueWatchingSortSelection, watchingUpdates],
  );

  // 🚀 TanStack Query - 收藏列表
  const { data: favorites = [] } = useFavoritesQuery({
    enabled: dataQueryEnabled,
  });

  // WatchingFollow 在远端与 localStorage 模式下使用同一查询入口。
  const {
    list: watchingFollows,
    follows,
    isFollowing,
    createFollow,
    deleteFollow,
    confirmWatchedToLatest,
    refresh: refreshWatchingFollows,
    isFollowPending,
    isStateKnown: isFollowStateKnown,
  } = useWatchingFollows();
  const { data: sources = [] } = useSourcesQuery({
    enabled: isWatchingUpdatesOpen || isContinueWatchingOpen,
  });
  const watchingFollowSourceNames = new Map(
    sources.map((source) => [source.key, source.name || source.key]),
  );

  // 🚀 TanStack Query - 修改密码
  const changePasswordMutation = useChangePasswordMutation();

  // 确保组件已挂载
  useEffect(() => {
    setMounted(true);
  }, []);

  // 获取认证信息
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const auth = getAuthInfoFromBrowserCookie();
      setAuthInfo(auth);
    }
  }, []);

  useEffect(() => {
    if (!authInfo?.username || storageType === 'localstorage') {
      setNotificationUnread(0);
      return;
    }

    let active = true;
    fetch(USER_NOTIFICATIONS_ENDPOINT, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as {
          unread?: unknown;
        } | null;
      })
      .then((data) => {
        if (!active) return;
        const unread =
          typeof data?.unread === 'number' && Number.isFinite(data.unread)
            ? Math.max(0, Math.floor(data.unread))
            : 0;
        setNotificationUnread(unread);
      })
      .catch(() => {
        if (active) setNotificationUnread(0);
      });

    return () => {
      active = false;
    };
  }, [authInfo?.username, storageType]);

  // 🚀 观影室配置和下载配置由 TanStack Query 自动管理

  // 🚀 版本检查由 TanStack Query 自动管理

  const handleMenuClick = async () => {
    const willOpen = !isOpen;
    setIsOpen(willOpen);

    // 如果是打开菜单，强制刷新追番更新
    if (willOpen && showWatchingUpdates) {
      console.log('打开菜单时强制刷新追番更新...');
      refreshWatchingUpdates();
      void refetchPlayRecords();
    }
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogout = async () => {
    queryClient.removeQueries({ queryKey: WATCHING_UPDATES_QUERY_ROOT });
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    setIsOpen(false);
    // 修改点：用户菜单常用入口接入统一浏览器直跳策略，覆盖 /admin
    navigateWithBrowserPreference({
      href: '/admin',
      routerPush: (href) => router.push(href),
    });
  };

  const handlePlayStats = () => {
    setIsOpen(false);
    // 修改点：用户菜单常用入口接入统一浏览器直跳策略，覆盖 /play-stats
    navigateWithBrowserPreference({
      href: '/play-stats',
      routerPush: (href) => router.push(href),
    });
  };

  const handleTVBoxConfig = () => {
    setIsOpen(false);
    // 修改点：用户菜单常用入口接入统一浏览器直跳策略，覆盖 /tvbox
    navigateWithBrowserPreference({
      href: '/tvbox',
      routerPush: (href) => router.push(href),
    });
  };

  const handleWatchRoom = () => {
    setIsOpen(false);
    router.push('/watch-room');
  };

  const handleReleaseCalendar = () => {
    setIsOpen(false);
    // 修改点：用户菜单常用入口接入统一浏览器直跳策略，覆盖 /release-calendar
    navigateWithBrowserPreference({
      href: '/release-calendar',
      routerPush: (href) => router.push(href),
    });
  };

  const handleNotifications = () => {
    setIsOpen(false);
    setNotificationsTab('list');
    setIsNotificationsOpen(true);
  };

  const handleWatchingUpdates = () => {
    setIsOpen(false);
    setWatchingUpdatesTab('updates');
    void refreshWatchingFollows();
    setIsWatchingUpdatesOpen(true);
    // 注意：不在这里标记为已读，只有用户点击"不再提醒"时才标记
  };

  const handleCloseWatchingUpdates = () => {
    setIsWatchingUpdatesOpen(false);
  };

  const handleContinueWatching = () => {
    setIsOpen(false);
    void refetchPlayRecords();
    setIsContinueWatchingOpen(true);
  };

  const handleCloseContinueWatching = () => {
    setIsContinueWatchingOpen(false);
    // 修改点：关闭弹窗时一并收起排序面板，避免独立 Portal 残留
    setIsContinueWatchingSortOpen(false);
  };

  const handleFavorites = () => {
    setIsOpen(false);
    setIsFavoritesOpen(true);
  };

  const handleCloseNotifications = () => {
    setIsNotificationsOpen(false);
  };

  const handleCloseFavorites = () => {
    setIsFavoritesOpen(false);
  };

  // 忽略新上映提醒
  const handleDismissRelease = (sourceKey: string, videoId: string) => {
    const key = `${sourceKey}+${videoId}`;
    const newDismissed = new Set(dismissedReleases);
    newDismissed.add(key);
    setDismissedReleases(newDismissed);

    // 保存到localStorage
    try {
      localStorage.setItem(
        'moontv_dismissed_releases',
        JSON.stringify([...newDismissed]),
      );
    } catch (error) {
      console.error('保存已忽略列表失败:', error);
    }

    // 重新计算红点状态已由 TanStack Query 自动处理
  };

  // 从 key 中解析 source 和 id
  const parseKey = (key: string) => {
    return resolveContentIdentity(key) ?? { source: key, id: '' };
  };

  const resolveSourceKey = (source: string) =>
    sources.find((item) => item.key === source || item.name === source)?.key ||
    source;

  const handleToggleContinueWatchingFollow = async (
    record: PlayRecord & { key: string },
  ) => {
    const identity = parseKey(record.key);
    const source = resolveSourceKey(identity.source);

    try {
      if (isFollowing(source, identity.id)) {
        await deleteFollow(source, identity.id);
        toast.success('已取消加追');
        return;
      }

      const response = await fetch(
        `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(identity.id)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('详情获取失败，无法建立追更基线');

      const detail = await response.json();
      const latestEpisodes = Array.isArray(detail.episodes)
        ? detail.episodes.length
        : 0;
      if (latestEpisodes <= 0) throw new Error('详情缺少有效剧集信息');

      await createFollow({
        source,
        id: identity.id,
        title: detail.title || record.title,
        cover: detail.poster || record.cover,
        year: String(detail.year || record.year || ''),
        type:
          detail.type_name || record.type || (latestEpisodes > 1 ? 'tv' : ''),
        originalEpisodes: latestEpisodes,
        enabled: true,
      });
      toast.success('已加追');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '追更操作失败');
    }
  };

  const handleMarkContinueWatchingWatchedToLatest = async (
    record: PlayRecord & { key: string },
  ) => {
    const identity = parseKey(record.key);
    const source = resolveSourceKey(identity.source);
    if (!source || !identity.id) return;

    try {
      const matchedSeries = watchingUpdates?.updatedSeries?.find((series) =>
        compareContentIdentity(series, { source, id: identity.id }),
      );
      let latestEpisodes = matchedSeries?.latestEpisodes || 0;
      if (latestEpisodes <= 0) {
        const response = await fetch(
          `/api/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(identity.id)}`,
          { cache: 'no-store' },
        );
        if (!response.ok) throw new Error('详情获取失败，无法确认最新集数');
        const detail = await response.json();
        latestEpisodes = Array.isArray(detail.episodes)
          ? detail.episodes.length
          : 0;
      }
      if (latestEpisodes <= 0) throw new Error('详情缺少有效剧集信息');

      // This menu action confirms the follow baseline only. It deliberately
      // leaves PlayRecord.index/play_time untouched so the Continue Watching
      // card remains the user's real saved playback position.
      await confirmWatchedToLatest(source, identity.id, latestEpisodes);
      toast.success('已确认观看至最新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认失败');
    }
  };

  const handleMarkWatchingFollowWatchedToLatest = async (
    source: string,
    id: string,
    latestEpisodes: number,
  ) => {
    if (!source || !id || latestEpisodes <= 0) return;

    try {
      // 追更页和追更列表的菜单只推进 WatchingFollow baseline。
      // latestEpisodes 来自当前 Watching Updates / WatchingFollows 面板数据，
      // 不在长按菜单里重新请求详情，也不修改 PlayRecord。
      await confirmWatchedToLatest(source, id, latestEpisodes);
      toast.success('已确认观看至最新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认失败');
    }
  };

  // 计算播放进度百分比
  const getProgress = (record: PlayRecord) => {
    if (record.total_time === 0) return 0;
    return (record.play_time / record.total_time) * 100;
  };

  // 检查播放记录是否有新集数更新
  const getNewEpisodesCount = (
    record: PlayRecord & { key: string },
  ): number => {
    if (!watchingUpdates || !watchingUpdates.updatedSeries) return 0;

    const { source, id } = parseKey(record.key);

    // 在watchingUpdates中查找匹配的剧集
    const matchedSeries = watchingUpdates.updatedSeries.find(
      (series) =>
        series.hasNewEpisode && compareContentIdentity(series, { source, id }),
    );

    return matchedSeries ? matchedSeries.newEpisodes || 0 : 0;
  };

  const getLatestTotalEpisodes = (
    record: PlayRecord & { key: string },
  ): number => {
    const { source, id } = parseKey(record.key);
    const followSource = resolveSourceKey(source);
    const matchedSeries = watchingUpdates?.updatedSeries?.find((series) =>
      compareContentIdentity(series, { source: followSource, id }),
    );

    // UserMenu 的继续观看弹窗和首页 Continue Watching 共用同一状态语义：
    // 菜单只读取 Watching Updates 中可验证的 latestEpisodes，找不到时才回退
    // 到 PlayRecord 保存的总集数；它不修改播放记录，也不自行写入 baseline。
    return matchedSeries?.latestEpisodes || record.total_episodes;
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleCloseChangePassword = () => {
    setIsChangePasswordOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleSubmitChangePassword = async () => {
    setPasswordError('');

    // 验证密码
    if (!newPassword) {
      setPasswordError('新密码不得为空');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setPasswordLoading(true);

    changePasswordMutation.mutate(newPassword, {
      onSuccess: async () => {
        // 修改成功，关闭弹窗并登出
        setIsChangePasswordOpen(false);
        await handleLogout();
      },
      onError: (error) => {
        setPasswordError(error.message || '网络错误，请稍后重试');
      },
      onSettled: () => {
        setPasswordLoading(false);
      },
    });
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
  };

  // 检查是否显示管理面板按钮
  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';

  // UI-stage permission guard: keep NotificationCenter visible to normal users,
  // but show notification settings management only to admin / owner accounts.
  const showNotificationSettings = showAdminPanel;

  // 检查是否显示修改密码按钮
  const showChangePassword =
    authInfo?.role !== 'owner' && storageType !== 'localstorage';

  // 检查是否显示播放统计按钮（所有登录用户，且非localstorage存储）
  const showPlayStats = authInfo?.username && storageType !== 'localstorage';

  // 调试信息
  console.log('UserMenu 更新提醒调试:', {
    username: authInfo?.username,
    storageType,
    watchingUpdates,
    showWatchingUpdates,
    hasActualUpdates,
    totalUpdates,
  });

  // 角色中文映射
  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '';
    }
  };

  // 菜单面板内容
  const menuPanel = (
    <>
      {/* 背景遮罩 - 普通菜单无需模糊 */}
      <div
        className='fixed inset-0 bg-transparent z-1000'
        onClick={handleCloseMenu}
      />

      {/* 菜单面板 */}
      <div className='fixed top-14 right-4 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-xl z-1001 border border-gray-200/50 dark:border-gray-700/50 overflow-hidden select-none'>
        {/* 用户信息区域 */}
        <div className='px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-linear-to-r from-gray-50 to-gray-100/50 dark:from-gray-800 dark:to-gray-800/50'>
          <div className='space-y-1'>
            <div className='flex items-center justify-between'>
              <span className='text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                当前用户
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                  (authInfo?.role || 'user') === 'owner'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                    : (authInfo?.role || 'user') === 'admin'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                }`}
              >
                {getRoleText(authInfo?.role || 'user')}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <div className='font-semibold text-gray-900 dark:text-gray-100 text-sm truncate'>
                {authInfo?.username || 'default'}
              </div>
              <div className='text-[10px] text-gray-400 dark:text-gray-500'>
                数据存储：
                {storageType === 'localstorage' ? '本地' : storageType}
              </div>
            </div>
          </div>
        </div>

        {/* 菜单项 */}
        <div className='py-1'>
          {/* 设置按钮 */}
          <button
            onClick={handleSettings}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <Settings className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>设置</span>
          </button>

          {/* 更新提醒按钮 */}
          {showWatchingUpdates && (
            <button
              onClick={handleWatchingUpdates}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm relative'
            >
              <Bell className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>更新提醒</span>
              {hasActualUpdates && totalUpdates > 0 && (
                <div className='ml-auto flex items-center gap-1'>
                  <span className='inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full'>
                    {totalUpdates > 99 ? '99+' : totalUpdates}
                  </span>
                </div>
              )}
            </button>
          )}

          {/* 继续观看按钮 */}
          {showWatchingUpdates && (
            <button
              onClick={handleContinueWatching}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm relative'
            >
              <PlayCircle className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>继续观看</span>
              {continueWatchingRecords.length > 0 && (
                <span className='ml-auto text-xs text-gray-400'>
                  {continueWatchingRecords.length}
                </span>
              )}
            </button>
          )}

          {/* 我的收藏按钮 */}
          {showWatchingUpdates && (
            <button
              onClick={handleFavorites}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm relative'
            >
              <Heart className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>我的收藏</span>
              {favorites.length > 0 && (
                <span className='ml-auto text-xs text-gray-400'>
                  {favorites.length}
                </span>
              )}
            </button>
          )}

          {/* 管理面板按钮 */}
          <button
            onClick={handleNotifications}
            className='relative flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 transition-[background-color] duration-150 ease-in-out hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
          >
            <Bell className='h-4 w-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>通知中心</span>
            {notificationUnread > 0 && (
              <span className='ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white'>
                {notificationUnread > 99 ? '99+' : notificationUnread}
              </span>
            )}
          </button>

          {showAdminPanel && (
            <button
              onClick={handleAdminPanel}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <Shield className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>管理面板</span>
            </button>
          )}

          {/* 播放统计按钮 */}
          {showPlayStats && (
            <button
              onClick={handlePlayStats}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <BarChart3 className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>
                {authInfo?.role === 'owner' || authInfo?.role === 'admin'
                  ? '播放统计'
                  : '个人统计'}
              </span>
            </button>
          )}

          {/* 上映日程按钮 */}
          <button
            onClick={handleReleaseCalendar}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <Calendar className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>上映日程</span>
          </button>

          {/* TVBox配置按钮 */}
          <button
            onClick={handleTVBoxConfig}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <Tv className='w-4 h-4 text-gray-500 dark:text-gray-400' />
            <span className='font-medium'>TVBox 配置</span>
          </button>

          {/* 观影室按钮 */}
          {showWatchRoom && (
            <button
              onClick={handleWatchRoom}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <Users className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>观影室</span>
            </button>
          )}

          {/* 下载管理按钮 */}
          {downloadEnabled && (
            <button
              onClick={() => {
                setShowDownloadPanel(true);
                handleCloseMenu();
              }}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <Download className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>下载管理</span>
              {tasks.filter((t) => t.status === 'downloading').length > 0 && (
                <span className='ml-auto flex items-center gap-1'>
                  <span className='relative flex h-2 w-2'>
                    <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75'></span>
                    <span className='relative inline-flex rounded-full h-2 w-2 bg-green-500'></span>
                  </span>
                  <span className='text-xs text-green-600 dark:text-green-400'>
                    {tasks.filter((t) => t.status === 'downloading').length}
                  </span>
                </span>
              )}
              {tasks.length > 0 &&
                tasks.filter((t) => t.status === 'downloading').length ===
                  0 && (
                  <span className='ml-auto text-xs text-gray-400'>
                    {tasks.length}
                  </span>
                )}
            </button>
          )}

          {/* 修改密码按钮 */}
          {showChangePassword && (
            <button
              onClick={handleChangePassword}
              className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-[background-color] duration-150 ease-in-out text-sm'
            >
              <KeyRound className='w-4 h-4 text-gray-500 dark:text-gray-400' />
              <span className='font-medium'>修改密码</span>
            </button>
          )}

          {/* 分割线 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 登出按钮 */}
          <button
            onClick={handleLogout}
            className='w-full px-3 py-2 text-left flex items-center gap-2.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-[background-color] duration-150 ease-in-out text-sm'
          >
            <LogOut className='w-4 h-4' />
            <span className='font-medium'>登出</span>
          </button>

          {/* 分割线 */}
          <div className='my-1 border-t border-gray-200 dark:border-gray-700'></div>

          {/* 版本信息 */}
          <button
            onClick={() => {
              setIsVersionPanelOpen(true);
              handleCloseMenu();
            }}
            className='w-full px-3 py-2 text-center flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-xs'
          >
            <div className='flex items-center gap-1'>
              <span className='font-mono'>v{CURRENT_VERSION}</span>
              {!isChecking &&
                updateStatus &&
                updateStatus !== UpdateStatus.FETCH_FAILED && (
                  <div
                    className={`w-2 h-2 rounded-full -translate-y-2 ${
                      updateStatus === UpdateStatus.HAS_UPDATE
                        ? 'bg-yellow-500'
                        : updateStatus === UpdateStatus.NO_UPDATE
                          ? 'bg-green-400'
                          : ''
                    }`}
                  ></div>
                )}
            </div>
          </button>
        </div>
      </div>
    </>
  );

  // 修改密码面板内容
  const changePasswordPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-1000'
        onClick={handleCloseChangePassword}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 修改密码面板 */}
      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl z-1001 overflow-hidden'>
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className='h-full p-6'
          data-panel-content
          onTouchMove={(e) => {
            // 阻止事件冒泡到遮罩层，但允许内部滚动
            e.stopPropagation();
          }}
          style={{
            touchAction: 'auto', // 允许所有触摸操作
          }}
        >
          {/* 标题栏 */}
          <div className='flex items-center justify-between mb-6'>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              修改密码
            </h3>
            <button
              onClick={handleCloseChangePassword}
              className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              aria-label='Close'
            >
              <X className='w-full h-full' />
            </button>
          </div>

          {/* 表单 */}
          <div className='space-y-4'>
            {/* 新密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                新密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请输入新密码'
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 确认密码输入 */}
            <div>
              <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                确认密码
              </label>
              <input
                type='password'
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
                placeholder='请再次输入新密码'
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={passwordLoading}
              />
            </div>

            {/* 错误信息 */}
            {passwordError && (
              <div className='text-red-500 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800'>
                {passwordError}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className='flex gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <button
              onClick={handleCloseChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
              disabled={passwordLoading}
            >
              取消
            </button>
            <button
              onClick={handleSubmitChangePassword}
              className='flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
              disabled={passwordLoading || !newPassword || !confirmPassword}
            >
              {passwordLoading ? '修改中...' : '确认修改'}
            </button>
          </div>

          {/* 底部说明 */}
          <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              修改密码后需要重新登录
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 更新剧集海报弹窗内容
  const watchingUpdatesPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-1000'
        onClick={handleCloseWatchingUpdates}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 更新弹窗 */}
      <div
        className={`fixed top-1/2 left-1/2 z-1001 flex max-h-[90vh] w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-gray-900 ${MOBILE_DIALOG_FRAME_CLASS}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 内容容器 - 独立的滚动区域 */}
        <div
          className={`flex min-h-0 flex-1 flex-col p-6 ${MOBILE_DIALOG_CONTENT_CLASS}`}
          data-panel-content
          style={{
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
        >
          {/* 标题栏 */}
          <div
            className={`flex items-center justify-between mb-6 ${MOBILE_DIALOG_HEADER_CLASS}`}
          >
            <div className='flex items-center gap-3'>
              <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                更新提醒
              </h3>
              <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
                {watchingUpdates && watchingUpdates.updatedCount > 0 && (
                  <span className='inline-flex items-center gap-1'>
                    <div className='w-2 h-2 bg-red-500 rounded-full animate-pulse'></div>
                    {watchingUpdates.updatedCount}部有新集
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleCloseWatchingUpdates}
              className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800'
              aria-label='Close'
            >
              <X className='h-full w-full' />
            </button>
          </div>

          <div
            role='tablist'
            aria-label='更新提醒'
            className='mb-4 grid shrink-0 grid-cols-3 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800'
          >
            <button
              type='button'
              role='tab'
              aria-selected={watchingUpdatesTab === 'updates'}
              onClick={() => setWatchingUpdatesTab('updates')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                watchingUpdatesTab === 'updates'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              更新提醒
            </button>
            <button
              type='button'
              role='tab'
              aria-selected={watchingUpdatesTab === 'follows'}
              onClick={() => setWatchingUpdatesTab('follows')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                watchingUpdatesTab === 'follows'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              我的追更
            </button>
            <button
              type='button'
              role='tab'
              aria-selected={watchingUpdatesTab === 'settings'}
              onClick={() => setWatchingUpdatesTab('settings')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                watchingUpdatesTab === 'settings'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              更新设置
            </button>
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
            <section
              role='tabpanel'
              className={watchingUpdatesTab === 'updates' ? 'block' : 'hidden'}
            >
              {/* 更新列表 */}
              <div className='space-y-8'>
                {/* 没有更新时的提示 */}
                {!hasActualUpdates && (
                  <div className={WATCHING_UPDATE_EMPTY_STATE_CLASS}>
                    <div className={WATCHING_UPDATE_EMPTY_TITLE_CLASS}>
                      暂无新剧集更新
                    </div>
                    <div className={WATCHING_UPDATE_EMPTY_DETAIL_CLASS}>
                      系统会定期检查您观看过的剧集是否有新集数更新
                    </div>
                  </div>
                )}
                {/* 新上映的剧集 */}
                {watchingUpdates &&
                  watchingUpdates.updatedSeries.filter(
                    (series) =>
                      series.hasNewRelease &&
                      !dismissedReleases.has(
                        `${series.sourceKey}+${series.videoId}`,
                      ),
                  ).length > 0 && (
                    <div className={WATCHING_UPDATE_SECTION_CLASS}>
                      <div className={WATCHING_UPDATE_SECTION_HEADER_CLASS}>
                        <h4 className={WATCHING_UPDATE_SECTION_TITLE_CLASS}>
                          🎬 新上映
                        </h4>
                        <div className='flex items-center gap-1'>
                          <div className='w-2 h-2 bg-green-500 rounded-full animate-pulse'></div>
                          <span
                            className={`${WATCHING_UPDATE_SECTION_COUNT_CLASS} text-green-500`}
                          >
                            {
                              watchingUpdates.updatedSeries.filter(
                                (series) =>
                                  series.hasNewRelease &&
                                  !dismissedReleases.has(
                                    `${series.sourceKey}+${series.videoId}`,
                                  ),
                              ).length
                            }
                            部新上映
                          </span>
                        </div>
                      </div>

                      <div className={WATCHING_UPDATE_CARD_GRID_CLASS}>
                        {watchingUpdates.updatedSeries
                          .filter(
                            (series) =>
                              series.hasNewRelease &&
                              !dismissedReleases.has(
                                `${series.sourceKey}+${series.videoId}`,
                              ),
                          )
                          .map((series, index) => (
                            <div
                              key={`release-${series.title}_${series.year}_${index}`}
                              className={WATCHING_UPDATE_CARD_SHELL_CLASS}
                            >
                              <div
                                className={WATCHING_UPDATE_CARD_CONTENT_CLASS}
                              >
                                <VideoCard
                                  title={series.title}
                                  poster={series.cover}
                                  year={series.year}
                                  source={series.sourceKey}
                                  source_name={series.source_name}
                                  episodes={series.totalEpisodes}
                                  id={series.videoId}
                                  onDelete={undefined}
                                  type={
                                    series.totalEpisodes > 1 ? 'tv' : 'movie'
                                  }
                                  from='favorite'
                                  remarks={series.remarks}
                                  releaseDate={series.releaseDate}
                                />
                              </div>
                              {/* 新上映徽章 */}
                              <div className='absolute -top-2 -right-2 bg-green-600 text-white text-xs px-2 py-0.5 rounded-md shadow-lg animate-pulse z-10 font-bold'>
                                新上映
                              </div>
                              {/* 不再提醒按钮 */}
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDismissRelease(
                                    series.sourceKey,
                                    series.videoId,
                                  );
                                }}
                                className='absolute -top-2 -left-2 bg-gray-800/80 hover:bg-gray-900 text-white rounded-full p-1 shadow-lg z-10 opacity-0 group-hover/card:opacity-100 transition-opacity'
                                title='不再提醒'
                              >
                                <X className='w-3 h-3' />
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                {/* 有新集数的剧集 */}
                {watchingUpdates &&
                  watchingUpdates.updatedSeries.filter(
                    (series) => series.hasNewEpisode,
                  ).length > 0 && (
                    <div>
                      <div className={WATCHING_UPDATE_SECTION_HEADER_CLASS}>
                        <h4 className={WATCHING_UPDATE_SECTION_TITLE_CLASS}>
                          新集更新
                        </h4>
                        <div className='flex items-center gap-1'>
                          <div className='w-2 h-2 bg-red-500 rounded-full animate-pulse'></div>
                          <span
                            className={`${WATCHING_UPDATE_SECTION_COUNT_CLASS} text-red-500`}
                          >
                            {
                              watchingUpdates.updatedSeries.filter(
                                (series) => series.hasNewEpisode,
                              ).length
                            }
                            部剧集有更新
                          </span>
                        </div>
                      </div>

                      <div className={WATCHING_UPDATE_CARD_GRID_CLASS}>
                        {watchingUpdates.updatedSeries
                          .filter((series) => series.hasNewEpisode)
                          .map((series, index) => {
                            const latestEpisodes =
                              series.latestEpisodes || series.totalEpisodes;
                            const followBaselineMenuState =
                              getWatchingFollowBaselineMenuState(
                                follows,
                                series.sourceKey,
                                series.videoId,
                                latestEpisodes,
                              );

                            return (
                              <div
                                key={`new-${series.title}_${series.year}_${index}`}
                                className={WATCHING_UPDATE_CARD_SHELL_CLASS}
                              >
                                <div
                                  className={WATCHING_UPDATE_CARD_CONTENT_CLASS}
                                >
                                  <VideoCard
                                    title={series.title}
                                    poster={series.cover}
                                    year={series.year}
                                    source={series.sourceKey}
                                    source_name={series.source_name}
                                    episodes={latestEpisodes}
                                    currentEpisode={series.currentEpisode}
                                    id={series.videoId}
                                    onDelete={undefined}
                                    type={series.totalEpisodes > 1 ? 'tv' : ''}
                                    from='playrecord'
                                    followLoading={isFollowPending(
                                      series.sourceKey,
                                      series.videoId,
                                    )}
                                    markWatchedToLatestAction={
                                      followBaselineMenuState
                                        ? {
                                            title:
                                              followBaselineMenuState.title,
                                            isAlreadyAtLatest:
                                              followBaselineMenuState.isAlreadyAtLatest,
                                            onClick: () =>
                                              handleMarkWatchingFollowWatchedToLatest(
                                                series.sourceKey,
                                                series.videoId,
                                                latestEpisodes,
                                              ),
                                          }
                                        : undefined
                                    }
                                  />
                                </div>
                                {/* 新集数徽章 - Netflix 统一风格 */}
                                <div className='absolute -top-2 -right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded-md shadow-lg animate-pulse z-10 font-bold'>
                                  +{series.newEpisodes}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
              </div>

              {/* 底部说明 */}
              <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
                <p className={WATCHING_UPDATE_FOOTNOTE_CLASS}>
                  点击海报即可观看新更新的剧集
                </p>
              </div>
            </section>

            <section
              role='tabpanel'
              className={watchingUpdatesTab === 'follows' ? 'block' : 'hidden'}
            >
              <div className={WATCHING_UPDATE_SECTION_HEADER_CLASS}>
                <h4 className={WATCHING_UPDATE_SECTION_TITLE_CLASS}>
                  追更列表
                </h4>
                {watchingFollows.length > 0 && (
                  <span
                    className={`${WATCHING_UPDATE_SECTION_COUNT_CLASS} text-gray-500 dark:text-gray-400`}
                  >
                    共 {watchingFollows.length} 项
                  </span>
                )}
              </div>

              <div className={WATCHING_UPDATE_CARD_GRID_CLASS}>
                {watchingFollows.map((follow) => {
                  const update = watchingUpdates?.updatedSeries.find((series) =>
                    compareContentIdentity(series, follow),
                  );
                  const latestEpisodes =
                    update?.latestEpisodes ?? follow.originalEpisodes;
                  const followBaselineMenuState =
                    getWatchingFollowBaselineMenuState(
                      follows,
                      follow.source,
                      follow.id,
                      latestEpisodes,
                    );

                  return (
                    <div
                      key={watchingFollowKey(follow.source, follow.id)}
                      className={WATCHING_UPDATE_CARD_SHELL_CLASS}
                    >
                      <div className={WATCHING_UPDATE_CARD_CONTENT_CLASS}>
                        <VideoCard
                          id={follow.id}
                          title={follow.title}
                          poster={follow.cover}
                          year={follow.year}
                          source={follow.source}
                          source_name={
                            watchingFollowSourceNames.get(follow.source) ||
                            follow.source
                          }
                          episodes={latestEpisodes}
                          currentEpisode={update?.currentEpisode}
                          from='follow'
                          type={follow.type || ''}
                          followLoading={isFollowPending(
                            follow.source,
                            follow.id,
                          )}
                          onDelete={() =>
                            void deleteFollow(follow.source, follow.id)
                          }
                          markWatchedToLatestAction={
                            followBaselineMenuState
                              ? {
                                  title: followBaselineMenuState.title,
                                  isAlreadyAtLatest:
                                    followBaselineMenuState.isAlreadyAtLatest,
                                  onClick: () =>
                                    handleMarkWatchingFollowWatchedToLatest(
                                      follow.source,
                                      follow.id,
                                      latestEpisodes,
                                    ),
                                }
                              : undefined
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {watchingFollows.length === 0 && (
                <div className='py-12 text-center'>
                  <ListChecks className='mx-auto mb-4 h-16 w-16 text-gray-300 dark:text-gray-600' />
                  <p className='mb-2 text-gray-500 dark:text-gray-400'>
                    暂无追更
                  </p>
                  <p className='text-xs text-gray-400 dark:text-gray-500'>
                    在详情页点击追更按钮即可添加
                  </p>
                </div>
              )}

              <div className='mt-6 border-t border-gray-200 pt-4 dark:border-gray-700'>
                <p className={WATCHING_UPDATE_FOOTNOTE_CLASS}>
                  点击海报即可播放，长按或右键查看更多操作
                </p>
              </div>
            </section>

            <aside
              role='tabpanel'
              className={watchingUpdatesTab === 'settings' ? 'block' : 'hidden'}
            >
              <WatchingUpdateSettingsPage embedded />
            </aside>
          </div>
        </div>
      </div>
    </>
  );

  // 继续观看弹窗内容
  const continueWatchingPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-1000'
        onClick={handleCloseContinueWatching}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 继续观看弹窗 */}
      <div
        className='fixed inset-x-4 top-1/2 transform -translate-y-1/2 max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-1001 max-h-[80vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6'>
          <div className='flex items-center justify-between mb-4'>
            <h3 className='text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2'>
              <PlayCircle className='w-6 h-6 text-blue-500' />
              继续观看
            </h3>
            <div className='flex items-center gap-1'>
              {/* 修改点：排序按钮（与 APP 同款排序），当前排序方式作为提示 */}
              <button
                onClick={() => setIsContinueWatchingSortOpen(true)}
                className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-gray-300 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md'
              >
                <ArrowUpDown className='w-4 h-4' />
                <span className='hidden sm:inline'>
                  {continueWatchingSortLabel(
                    continueWatchingSortSelection.type,
                  )}
                </span>
              </button>
              <button
                onClick={handleCloseContinueWatching}
                className='p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
              >
                <X className='w-5 h-5' />
              </button>
            </div>
          </div>

          {/* 播放记录网格（修改点：使用共享排序后的记录） */}
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {continueWatchingRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              const followSource = resolveSourceKey(source);
              const newEpisodesCount = getNewEpisodesCount(record);
              const latestTotalEpisodes = getLatestTotalEpisodes(record);
              const followBaselineMenuState =
                getWatchingFollowBaselineMenuState(
                  follows,
                  followSource,
                  id,
                  latestTotalEpisodes,
                );
              return (
                <div key={record.key} className='relative group/card'>
                  <div className='relative group-hover/card:z-5 transition-all duration-300'>
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={latestTotalEpisodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      type={record.total_episodes > 1 ? 'tv' : ''}
                      remarks={record.remarks}
                      following={
                        isFollowStateKnown
                          ? isFollowing(followSource, id)
                          : false
                      }
                      followLoading={
                        !isFollowStateKnown || isFollowPending(followSource, id)
                      }
                      onToggleFollow={
                        isFollowStateKnown
                          ? () => handleToggleContinueWatchingFollow(record)
                          : undefined
                      }
                      markWatchedToLatestAction={
                        followBaselineMenuState
                          ? {
                              title: followBaselineMenuState.title,
                              isAlreadyAtLatest:
                                followBaselineMenuState.isAlreadyAtLatest,
                              onClick: () =>
                                handleMarkContinueWatchingWatchedToLatest(
                                  record,
                                ),
                            }
                          : undefined
                      }
                    />
                  </div>
                  {/* 新集数徽章 - Netflix 统一风格 */}
                  {newEpisodesCount > 0 && (
                    <div className='absolute -top-2 -right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded-md shadow-lg animate-pulse z-10 font-bold'>
                      +{newEpisodesCount}
                    </div>
                  )}
                  {/* 进度指示器 */}
                  {getProgress(record) > 0 && (
                    <div className='absolute bottom-2 left-2 right-2 bg-black/50 rounded px-2 py-1'>
                      <div className='flex items-center gap-1'>
                        <div className='flex-1 bg-gray-600 rounded-full h-1'>
                          <div
                            className='bg-blue-500 h-1 rounded-full transition-all'
                            style={{
                              width: `${Math.min(getProgress(record), 100)}%`,
                            }}
                          />
                        </div>
                        <span className='text-xs text-white font-medium'>
                          {Math.round(getProgress(record))}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 空状态 */}
          {continueWatchingRecords.length === 0 && (
            <div className='text-center py-12'>
              <PlayCircle className='w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4' />
              <p className='text-gray-500 dark:text-gray-400 mb-2'>
                暂无需要继续观看的内容
              </p>
              <p className='text-xs text-gray-400 dark:text-gray-500'>
                {enableContinueWatchingFilter
                  ? `观看进度在${continueWatchingMinProgress}%-${continueWatchingMaxProgress}%之间且播放时间超过2分钟的内容会显示在这里`
                  : '播放时间超过2分钟的所有内容都会显示在这里'}
              </p>
            </div>
          )}

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              点击海报即可继续观看
            </p>
          </div>
        </div>
      </div>
    </>
  );

  // 我的收藏弹窗内容
  const favoritesPanel = (
    <>
      {/* 背景遮罩 */}
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-1000'
        onClick={handleCloseFavorites}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{
          touchAction: 'none',
        }}
      />

      {/* 收藏弹窗 */}
      <div
        className='fixed inset-x-4 top-1/2 transform -translate-y-1/2 max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-1001 max-h-[80vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6'>
          <div className='flex items-center justify-between mb-4'>
            <h3 className='text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2'>
              <Heart className='w-6 h-6 text-red-500' />
              我的收藏
            </h3>
            <button
              onClick={handleCloseFavorites}
              className='p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          {/* 收藏网格 */}
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4'>
            {favorites.map((favorite) => {
              const { source, id } = parseKey(favorite.key);

              // 智能计算即将上映状态
              let calculatedRemarks = favorite.remarks;
              let isNewRelease = false;

              if (favorite.releaseDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const releaseDate = new Date(favorite.releaseDate);
                const daysDiff = Math.ceil(
                  (releaseDate.getTime() - today.getTime()) /
                    (1000 * 60 * 60 * 24),
                );

                // 根据天数差异动态更新显示文字
                if (daysDiff < 0) {
                  const daysAgo = Math.abs(daysDiff);
                  calculatedRemarks = `已上映${daysAgo}天`;
                  // 7天内上映的标记为新上映
                  if (daysAgo <= 7) {
                    isNewRelease = true;
                  }
                } else if (daysDiff === 0) {
                  calculatedRemarks = '今日上映';
                  isNewRelease = true;
                } else {
                  calculatedRemarks = `${daysDiff}天后上映`;
                }
              }

              return (
                <div key={favorite.key} className='relative'>
                  <VideoCard
                    id={id}
                    title={favorite.title}
                    poster={favorite.cover}
                    year={favorite.year}
                    source={source}
                    source_name={favorite.source_name}
                    episodes={favorite.total_episodes}
                    query={favorite.search_title}
                    from='favorite'
                    type={favorite.total_episodes > 1 ? 'tv' : ''}
                    remarks={calculatedRemarks}
                    releaseDate={favorite.releaseDate}
                  />
                  {/* 收藏心形图标 - 隐藏，使用VideoCard内部的hover爱心 */}
                  {/* 新上映高亮标记 - Netflix 统一风格 - 7天内上映的显示 */}
                  {isNewRelease && (
                    <div className='absolute top-2 left-2 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-md shadow-lg animate-pulse z-40'>
                      新上映
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 空状态 */}
          {favorites.length === 0 && (
            <div className='text-center py-12'>
              <Heart className='w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4' />
              <p className='text-gray-500 dark:text-gray-400 mb-2'>暂无收藏</p>
              <p className='text-xs text-gray-400 dark:text-gray-500'>
                在详情页点击收藏按钮即可添加收藏
              </p>
            </div>
          )}

          {/* 底部说明 */}
          <div className='mt-6 pt-4 border-t border-gray-200 dark:border-gray-700'>
            <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
              点击海报即可进入详情页面
            </p>
          </div>
        </div>
      </div>
    </>
  );

  const notificationsPanel = (
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-1000'
        onClick={handleCloseNotifications}
        onTouchMove={(e) => {
          e.preventDefault();
        }}
        onWheel={(e) => {
          e.preventDefault();
        }}
        style={{ touchAction: 'none' }}
      />

      <div
        className={`fixed inset-x-2 top-1/2 z-1001 mx-auto max-h-[88vh] max-w-6xl -translate-y-1/2 transform overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:inset-x-4 ${MOBILE_DIALOG_FRAME_CLASS}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex max-h-[88vh] flex-col p-4 sm:p-6 ${MOBILE_DIALOG_CONTENT_CLASS}`}
        >
          <div
            className={`mb-4 flex items-center justify-between ${MOBILE_DIALOG_HEADER_CLASS}`}
          >
            <h3 className='flex items-center gap-2 text-xl font-bold text-gray-900 dark:text-white'>
              <Bell className='h-6 w-6 text-blue-500' />
              通知中心
              {notificationUnread > 0 && (
                <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white'>
                  {notificationUnread > 99 ? '99+' : notificationUnread}
                </span>
              )}
            </h3>
            <button
              onClick={handleCloseNotifications}
              className='p-2 text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              aria-label='关闭通知中心'
            >
              <X className='h-5 w-5' />
            </button>
          </div>

          <div
            className={`mb-4 grid ${
              showNotificationSettings ? 'grid-cols-2' : 'grid-cols-1'
            } rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800`}
          >
            <button
              type='button'
              onClick={() => setNotificationsTab('list')}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                notificationsTab === 'list'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              通知列表
            </button>
            {showNotificationSettings && (
              <button
                type='button'
                onClick={() => setNotificationsTab('settings')}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  notificationsTab === 'settings'
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                通知设置
              </button>
            )}
          </div>

          <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
            <div className='space-y-5'>
              <section
                className={notificationsTab === 'list' ? 'block' : 'hidden'}
              >
                <NotificationCenterPage embedded />
              </section>
              {showNotificationSettings && (
                <aside
                  className={
                    notificationsTab === 'settings' ? 'block' : 'hidden'
                  }
                >
                  <NotificationSettingsPage embedded />
                </aside>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          onClick={handleMenuClick}
          className='relative w-10 h-10 p-2 rounded-full flex items-center justify-center text-gray-600 hover:text-blue-500 dark:text-gray-300 dark:hover:text-blue-400 transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-blue-500/30 dark:hover:shadow-blue-400/30 group'
          aria-label='User Menu'
        >
          {/* 微光背景效果 */}
          <div className='absolute inset-0 rounded-full bg-linear-to-br from-blue-400/0 to-purple-600/0 group-hover:from-blue-400/20 group-hover:to-purple-600/20 dark:group-hover:from-blue-300/20 dark:group-hover:to-purple-500/20 transition-all duration-300'></div>

          <User className='w-full h-full relative z-10 group-hover:scale-110 transition-transform duration-300' />
        </button>
        {/* 🔧 修改点：版本更新优先显示黄点，仅有更新提醒时显示红点 */}
        {userMenuIndicatorColor && (
          <div
            className={`absolute top-[2px] right-[2px] w-2 h-2 rounded-full animate-pulse shadow-lg ${
              userMenuIndicatorColor === 'yellow'
                ? 'bg-yellow-500 shadow-yellow-500/50'
                : 'bg-red-500 shadow-red-500/50'
            }`}
          ></div>
        )}
      </div>

      {/* 使用 Portal 将菜单面板渲染到 document.body */}
      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {/* 使用 Portal 将设置面板渲染到 document.body */}
      {isSettingsOpen && mounted && (
        <SettingsPanel isOpen={isSettingsOpen} onClose={handleCloseSettings} />
      )}

      {/* 使用 Portal 将修改密码面板渲染到 document.body */}
      {isChangePasswordOpen &&
        mounted &&
        createPortal(changePasswordPanel, document.body)}

      {/* 使用 Portal 将更新提醒面板渲染到 document.body */}
      {isWatchingUpdatesOpen &&
        mounted &&
        createPortal(watchingUpdatesPanel, document.body)}

      {/* 使用 Portal 将继续观看面板渲染到 document.body */}
      {isContinueWatchingOpen &&
        mounted &&
        createPortal(continueWatchingPanel, document.body)}

      {/* 修改点：继续观看排序面板（与 APP 同款，弹窗内打开，主页共用同一偏好） */}
      <ContinueWatchingSortPanel
        isOpen={isContinueWatchingSortOpen}
        selection={continueWatchingSortSelection}
        onSelect={selectContinueWatchingSortType}
        onClose={() => setIsContinueWatchingSortOpen(false)}
      />

      {/* 使用 Portal 将我的收藏面板渲染到 document.body */}
      {isFavoritesOpen &&
        mounted &&
        createPortal(favoritesPanel, document.body)}

      {/* 使用 Portal 将通知中心面板渲染到 document.body */}
      {isNotificationsOpen &&
        mounted &&
        createPortal(notificationsPanel, document.body)}

      {/* 版本面板 */}
      <VersionPanel
        isOpen={isVersionPanelOpen}
        onClose={() => setIsVersionPanelOpen(false)}
      />
    </>
  );
};
