import type { WatchingUpdateItem } from './watching-update-result';

export type WatchingUpdateSortField =
  | 'name'
  | 'episodes'
  | 'resource'
  | 'detectedTime';

export type WatchingUpdateSortOrder = 'asc' | 'desc';

export function sortWatchingUpdates(
  items: WatchingUpdateItem[],
  {
    field,
    order = field === 'detectedTime' ? 'desc' : 'asc',
  }: {
    field: WatchingUpdateSortField;
    order?: WatchingUpdateSortOrder;
  },
): WatchingUpdateItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry.item;
      const right = rightEntry.item;

      if (field === 'detectedTime') {
        if (left.detectedAt == null && right.detectedAt == null) {
          return leftEntry.index - rightEntry.index;
        }
        if (left.detectedAt == null) return 1;
        if (right.detectedAt == null) return -1;
      }

      const comparison = compareByField(left, right, field);
      if (comparison !== 0) {
        return order === 'desc' ? -comparison : comparison;
      }
      return leftEntry.index - rightEntry.index;
    })
    .map(({ item }) => item);
}

function compareByField(
  left: WatchingUpdateItem,
  right: WatchingUpdateItem,
  field: WatchingUpdateSortField,
): number {
  switch (field) {
    case 'name':
      return compareTitles(left, right);
    case 'episodes':
      return left.newEpisodes - right.newEpisodes;
    case 'resource': {
      const sourceComparison = compareNormalizedStrings(
        left.sourceName,
        right.sourceName,
      );
      return sourceComparison || compareTitles(left, right);
    }
    case 'detectedTime':
      return (left.detectedAt ?? 0) - (right.detectedAt ?? 0);
  }
}

function compareTitles(
  left: WatchingUpdateItem,
  right: WatchingUpdateItem,
): number {
  return compareNormalizedStrings(left.title, right.title);
}

function compareNormalizedStrings(left: string, right: string): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}
