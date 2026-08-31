'use client';

/**
 * 追更提醒排序面板（仿 APP MediaSortSheet）
 *
 * 修改点：为用户菜单「更新提醒」Tab（新集更新区）提供与 APP 一致的排序设置面板，
 * 交互与「继续观看 / 收藏夹」排序面板相同：点击当前字段切换升降序，
 * 点击新字段使用该字段默认方向；当前选中项显示方向箭头与方向文案。
 */

import {
  WATCHING_UPDATES_SORT_OPTIONS,
  watchingUpdatesSortDirectionLabel,
  watchingUpdatesSortLabel,
  type WatchingUpdatesSortSelection,
  type WatchingUpdatesSortType,
} from '@/lib/watching-updates-sort';

import SortSelectionPanel from './SortSelectionPanel';

interface WatchingUpdatesSortPanelProps {
  isOpen: boolean;
  selection: WatchingUpdatesSortSelection;
  onSelect: (type: WatchingUpdatesSortType) => void;
  onClose: () => void;
}

export function WatchingUpdatesSortPanel({
  isOpen,
  selection,
  onSelect,
  onClose,
}: WatchingUpdatesSortPanelProps) {
  return (
    <SortSelectionPanel
      isOpen={isOpen}
      title='更新提醒排序'
      options={WATCHING_UPDATES_SORT_OPTIONS}
      selection={selection}
      labelOf={watchingUpdatesSortLabel}
      directionLabelOf={watchingUpdatesSortDirectionLabel}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

export default WatchingUpdatesSortPanel;
