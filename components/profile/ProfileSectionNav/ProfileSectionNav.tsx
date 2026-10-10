import Link from 'next/link'

import { PROFILE_SECTIONS } from '@/components/profile/profileSections'

import styles from './ProfileSectionNav.module.css'

interface ProfileSectionNavProps {
  hasBankConfigured?: boolean
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

// The Settings index list: one row per sub-page, each linking to its own route.
export function ProfileSectionNav({ hasBankConfigured }: ProfileSectionNavProps) {
  return (
    <nav className={styles.nav} aria-label="Settings sections">
      <ul className={styles.list}>
        {PROFILE_SECTIONS.map((section) => {
          const badge =
            section.key === 'payout'
              ? hasBankConfigured
                ? 'Ready'
                : 'Action needed'
              : null

          return (
            <li key={section.key} className={styles.item}>
              <Link href={`/dashboard/settings/${section.key}`} className={styles.link}>
                <span className={styles.label}>
                  <span>{section.label}</span>
                  {badge && (
                    <span
                      className={`${styles.badge} ${
                        badge === 'Ready' ? styles.badgeSuccess : styles.badgeWarning
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </span>
                <span className={styles.chevron}>
                  <ChevronRightIcon />
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}