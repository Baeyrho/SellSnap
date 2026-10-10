import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { PageShell } from '@/components/layout/PageShell/PageShell'
import { ProfileView } from '@/components/profile/ProfileView/ProfileView'
import { PROFILE_SECTIONS } from '@/components/profile/profileSections'

import { getSettingsUser } from '../settings-data'

interface SettingsSectionPageProps {
  params: Promise<{ section: string }>
}

function findSection(section: string) {
  return PROFILE_SECTIONS.find((item) => item.key === section)
}

export async function generateMetadata({ params }: SettingsSectionPageProps): Promise<Metadata> {
  const { section: sectionKey } = await params
  const section = findSection(sectionKey)

  return { title: section ? `${section.label} — SellSnap` : 'Settings — SellSnap' }
}

// One sub-page per route: only that section renders, with the back control
// returning to the settings list. No section list is repeated here.
export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { section: sectionKey } = await params
  const section = findSection(sectionKey)

  if (!section) {
    notFound()
  }

  const user = await getSettingsUser()

  return (
    <PageShell
      title={section.label}
      backHref="/dashboard/settings"
      backLabel="Back to settings"
    >
      <ProfileView user={user} section={section.key} />
    </PageShell>
  )
}