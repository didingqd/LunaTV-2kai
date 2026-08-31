'use client';

/**
 * 收藏排序面板（仿 APP MediaSortSheet）
 *
 * 修改点：为 Web 端「收藏夹」提供与 APP 一致的排序设置面板，
 * 交互与「继续观看」排序面板相同：点击当前字段切换升降序，
 * 点击新字段使用该字段默认方向；当前选中项显示方向箭头与方向文案。
 */

import {
  FAVORITES_SORT_OPTIONS,
  favoritesSortDirectionLabel,
  favoritesSortLabel,
  type FavoritesSortSelection,
  type FavoritesSortType,
} from '@/lib/favorites-sort';

import SortSelectionPanel from './SortSelectionPanel';

interface FavoritesSortPanelProps {
  isOpen: boolean;
  selection: FavoritesSortSelection;
  onSelect: (type: FavoritesSortType) => void;
  onClose: () => void;
}

export function FavoritesSortPanel({
  isOpen,
  selection,
  onSelect,
  onClose,
}: FavoritesSortPanelProps) {
  return (
    <SortSelectionPanel
      isOpen={isOpen}
      options={FAVORITES_SORT_OPTIONS}
      selection={selection}
      labelOf={favoritesSortLabel}
      directionLabelOf={favoritesSortDirectionLabel}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

export default FavoritesSortPanel;
