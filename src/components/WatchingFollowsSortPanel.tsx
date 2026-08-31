'use client';

/**
 * 追更列表排序面板（仿 APP MediaSortSheet）
 *
 * 修改点：为用户菜单「更新提醒 → 我的追更」列表提供与 APP 一致的排序设置面板，
 * 交互与「继续观看 / 收藏夹」排序面板相同：点击当前字段切换升降序，
 * 点击新字段使用该字段默认方向；当前选中项显示方向箭头与方向文案。
 */

import {
  WATCHING_FOLLOWS_SORT_OPTIONS,
  watchingFollowsSortDirectionLabel,
  watchingFollowsSortLabel,
  type WatchingFollowsSortSelection,
  type WatchingFollowsSortType,
} from '@/lib/watching-follows-sort';

import SortSelectionPanel from './SortSelectionPanel';

interface WatchingFollowsSortPanelProps {
  isOpen: boolean;
  selection: WatchingFollowsSortSelection;
  onSelect: (type: WatchingFollowsSortType) => void;
  onClose: () => void;
}

export function WatchingFollowsSortPanel({
  isOpen,
  selection,
  onSelect,
  onClose,
}: WatchingFollowsSortPanelProps) {
  return (
    <SortSelectionPanel
      isOpen={isOpen}
      title='追更列表排序'
      options={WATCHING_FOLLOWS_SORT_OPTIONS}
      selection={selection}
      labelOf={watchingFollowsSortLabel}
      directionLabelOf={watchingFollowsSortDirectionLabel}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

export default WatchingFollowsSortPanel;
