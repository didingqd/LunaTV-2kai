import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { savePlayRecord } from '@/lib/db.client';
import type { PlayRecord } from '@/lib/types';

import { useSavePlayRecordMutation } from './usePlayRecordsMutations';

jest.mock('@/lib/db.client', () => ({
  savePlayRecord: jest.fn(),
  deletePlayRecord: jest.fn(),
  clearAllPlayRecords: jest.fn(),
}));

describe('PlayRecord mutation cache invalidation', () => {
  it('refreshes PlayRecord and WatchingUpdates after a successful save', async () => {
    jest.mocked(savePlayRecord).mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSavePlayRecordMutation(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        source: 'source-a',
        id: 'video-1',
        record: createRecord(),
      });
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['playRecords'],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['watchingUpdates'],
      });
    });
  });
});

function createRecord(): PlayRecord {
  return {
    title: 'Demo',
    source_name: 'Source A',
    cover: 'cover.jpg',
    year: '2026',
    index: 1,
    total_episodes: 12,
    play_time: 120,
    total_time: 1200,
    save_time: 1,
    search_title: 'Demo',
  };
}
