import Link from 'next/link'

import styles from './PageShell.module.css'

interface PageShellProps {
  title: string
  subtitle?: string
  backHref?: string
  backLabel?: string
  backVariant?: 'secondary' | 'outline' | 'ghost'
  actions?: React.ReactNode
  children: React.ReactNode
}

export function PageShell({
  title,
  subtitle,
  backHref,
  backLabel = 'Cancel',
  backVariant = 'secondary',
  actions,
  children,
}: PageShellProps) {
  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {(actions || backHref) && (
          <div className={styles.actions}>
            {actions}
            {backHref && (
              <Link
                href={backHref}
                className={`${styles.closeButton} ${styles[backVariant]}`}
                aria-label={backLabel}
                title={backLabel}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.closeIcon}
                  aria-hidden="true"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </Link>
            )}
          </div>
        )}
      </div>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  )
}
