import type { Metadata } from 'next'

import { PageShell } from '@/components/layout/PageShell/PageShell'
import { ProfileSectionNav } from '@/components/profile/ProfileSectionNav/ProfileSectionNav'

import { getSettingsUser } from './settings-data'

export const metadata: Metadata = {
  title: 'Settings — SellSnap',
}

// Index of the Settings sub-pages. It renders only the list; each entry has
// its own route under /dashboard/settings/[section].
export default async function SettingsPage() {
  const user = await getSettingsUser()

  return (
    <PageShell title="Settings">
      <ProfileSectionNav hasBankConfigured={Boolean(user.bankCode && user.accountNumber)} />
    </PageShell>
  )
}