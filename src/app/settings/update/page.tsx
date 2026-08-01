import PageLayout from '@/components/PageLayout';
import UpdateSettingsPage from '@/components/UpdateSettingsPage';

export default function UpdateSettingsRoute() {
  return (
    <PageLayout activePath='/settings/update'>
      <UpdateSettingsPage />
    </PageLayout>
  );
}
