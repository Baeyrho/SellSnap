import Link from 'next/link'

import styles from './DashboardHeader.module.css'

interface DashboardHeaderProps {
  onMenuClick: () => void
  menuOpen: boolean
}

export function DashboardHeader({ onMenuClick, menuOpen }: DashboardHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <button
          type="button"
          className={styles.menuBtn}
          onClick={onMenuClick}
          aria-label="Open navigation menu"
        >
          <span className={styles.menuBar} />
          <span className={styles.menuBar} />
          <span className={styles.menuBar} />
        </button>

        <Link
          href="/dashboard"
          className={`${styles.brandMobile}${menuOpen ? ` ${styles.brandHidden}` : ''}`}
        >
          SellSnap
        </Link>
      </div>
    </header>
  )
}
