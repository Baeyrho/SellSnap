import { ProfileInfoForm } from '@/components/profile/ProfileInfoForm/ProfileInfoForm'
import { AccountInfoForm } from '@/components/profile/AccountInfoForm/AccountInfoForm'
import { ProfileForm } from '@/components/profile/ProfileForm/ProfileForm'
import { ProfileNotifications } from '@/components/profile/ProfileNotifications/ProfileNotifications'
import { ProfileSecurity } from '@/components/profile/ProfileSecurity/ProfileSecurity'
import type { ProfileSectionKey } from '@/components/profile/profileSections'

import styles from './ProfileView.module.css'

interface UserData {
  id: string
  name: string
  email: string
  displayName: string | null
  businessName: string | null
  businessBio: string | null
  businessLocation: string | null
  whatsappNumber: string | null
  phoneNumber: string | null
  logoUrl: string | null
  bankCode: string | null
  accountNumber: string | null
  createdAt: Date | string
}

interface ProfileViewProps {
  user: UserData
  section: ProfileSectionKey
}

// Renders exactly one Settings sub-page. The section is decided by the route,
// so a sub-page is addressable, reloadable, and shareable on its own.
export function ProfileView({ user, section }: ProfileViewProps) {
  const hasBankConfigured = Boolean(user.bankCode && user.accountNumber)

  return (
    <>
      {section === 'business' && (
        <ProfileInfoForm
          initialDisplayName={user.displayName}
          initialBusinessName={user.businessName}
          initialBusinessBio={user.businessBio}
          initialBusinessLocation={user.businessLocation}
          initialWhatsappNumber={user.whatsappNumber}
          initialLogoUrl={user.logoUrl}
          fallbackName={user.name}
          hasBankConfigured={hasBankConfigured}
        />
      )}

      {section === 'account' && (
        <AccountInfoForm
          initialName={user.name}
          initialEmail={user.email}
          initialPhoneNumber={user.phoneNumber}
          createdAt={user.createdAt}
        />
      )}

      {section === 'payout' && (
        <div className={styles.payoutWrapper}>
          <ProfileForm
            initialName={user.name}
            initialEmail={user.email}
            initialBankCode={user.bankCode}
            initialAccountNumber={user.accountNumber}
            hideAccountOverview={true}
          />
        </div>
      )}

      {section === 'notifications' && (
        <ProfileNotifications
          sellerEmail={user.email}
          phoneNumber={user.phoneNumber}
          whatsappNumber={user.whatsappNumber}
        />
      )}

      {section === 'security' && <ProfileSecurity />}
    </>
  )
}