import type { ComponentProps } from 'react';

import WatchingUpdateSettingsPage from './WatchingUpdateSettingsPage';

export default function UpdateSettingsPage(
  props: ComponentProps<typeof WatchingUpdateSettingsPage>,
) {
  return <WatchingUpdateSettingsPage {...props} />;
}
