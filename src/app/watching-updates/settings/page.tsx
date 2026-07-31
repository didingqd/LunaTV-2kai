import PageLayout from '@/components/PageLayout';
import WatchingUpdateSettingsPage from '@/components/WatchingUpdateSettingsPage';

export default function UserWatchingUpdateSettingsRoute() {
  return (
    <PageLayout activePath='/watching-updates/settings'>
      <WatchingUpdateSettingsPage />
    </PageLayout>
  );
}
