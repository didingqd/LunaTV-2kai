import { fireEvent, render, screen } from '@testing-library/react';

import WatchingFollowButton from './WatchingFollowButton';

describe('WatchingFollowButton', () => {
  it('shows the add state and calls the toggle handler', () => {
    const onToggle = jest.fn();
    render(<WatchingFollowButton following={false} onToggle={onToggle} />);

    expect(screen.getByRole('button', { name: '添加追更' })).toHaveTextContent(
      '追更',
    );
    fireEvent.click(screen.getByRole('button', { name: '添加追更' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the followed state and disables while loading', () => {
    render(<WatchingFollowButton following loading onToggle={jest.fn()} />);

    const button = screen.getByRole('button', { name: '取消追更' });
    expect(button).toHaveTextContent('已追更');
    expect(button).toBeDisabled();
  });
});
