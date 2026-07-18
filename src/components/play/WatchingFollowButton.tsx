'use client';

import { Check, LoaderCircle, Plus } from 'lucide-react';
import { memo } from 'react';

interface WatchingFollowButtonProps {
  following: boolean;
  loading?: boolean;
  onToggle: () => void;
}

const WatchingFollowButton = memo(function WatchingFollowButton({
  following,
  loading = false,
  onToggle,
}: WatchingFollowButtonProps) {
  return (
    <button
      type='button'
      onClick={onToggle}
      disabled={loading}
      className='flex items-center gap-1.5 rounded-full border border-white/35 bg-white/12 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:cursor-wait disabled:opacity-60'
      aria-label={following ? '取消追更' : '添加追更'}
    >
      {loading ? (
        <LoaderCircle className='size-4 animate-spin' />
      ) : following ? (
        <Check className='size-4 text-emerald-300' />
      ) : (
        <Plus className='size-4' />
      )}
      {following ? '已追更' : '追更'}
    </button>
  );
});

export default WatchingFollowButton;
