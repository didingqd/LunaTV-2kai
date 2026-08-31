'use client';

/**
 * 继续观看排序面板（仿 APP MediaSortSheet）
 *
 * 修改点：面板的通用实现已提炼到 SortSelectionPanel（供收藏夹等列表共用），
 * 这里保留原有对外 API 与外观不变，仅做参数装配。
 */

import {
  CONTINUE_WATCHING_SORT_OPTIONS,
  continueWatchingSortDirectionLabel,
  continueWatchingSortLabel,
  type ContinueWatchingSortSelection,
  type ContinueWatchingSortType,
} from '@/lib/continue-watching-sort';

import SortSelectionPanel from './SortSelectionPanel';

interface ContinueWatchingSortPanelProps {
  isOpen: boolean;
  selection: ContinueWatchingSortSelection;
  onSelect: (type: ContinueWatchingSortType) => void;
  onClose: () => void;
}

export function ContinueWatchingSortPanel({
  isOpen,
  selection,
  onSelect,
  onClose,
}: ContinueWatchingSortPanelProps) {
  return (
    <SortSelectionPanel
      isOpen={isOpen}
      options={CONTINUE_WATCHING_SORT_OPTIONS}
      selection={selection}
      labelOf={continueWatchingSortLabel}
      directionLabelOf={continueWatchingSortDirectionLabel}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

export default ContinueWatchingSortPanel;
