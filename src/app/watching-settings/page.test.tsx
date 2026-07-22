import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { WATCHING_UPDATE_SOURCE_MODE_KEY } from '@/lib/watching-update-preference';

import WatchingSettingsPage from './page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/BackButton', () => ({
  BackButton: () => <button type='button'>返回</button>,
}));

describe('WatchingSettingsPage', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to local and saves the backend preference', () => {
    render(<WatchingSettingsPage />);

    const local = screen.getByRole('radio', { name: /本地计算/ });
    const backend = screen.getByRole('radio', {
      name: /后端获取 \+ 本地核验/,
    });
    expect(local).toBeChecked();
    expect(backend).not.toBeChecked();

    fireEvent.click(backend);

    expect(backend).toBeChecked();
    expect(window.localStorage.getItem(WATCHING_UPDATE_SOURCE_MODE_KEY)).toBe(
      'backend',
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
