import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import styles from './DashboardSidebar.module.css'

interface DashboardSidebarProps {
  userName: string
  userEmail?: string
  open: boolean
  collapsed: boolean
  onClose: () => void
  onToggleCollapse: () => void
}

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

function OverviewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  )
}

function ProductsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20.6 7.2 12 12 3.4 7.2" />
      <path d="M12 12v9" />
      <path d="M3.4 7.2 12 3l8.6 4.2v9.6L12 21l-8.6-4.2z" />
    </svg>
  )
}

function OrdersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-3.5-2-2.5 2-2.5-2L7 21V4a1 1 0 0 1 1-1" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: <OverviewIcon /> },
  { label: 'Products', href: '/dashboard/products', icon: <ProductsIcon /> },
  { label: 'Orders', href: '/dashboard/orders', icon: <OrdersIcon /> },
  { label: 'Settings', href: '/dashboard/settings', icon: <SettingsIcon /> },
]

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function DashboardSidebar({
  userName,
  userEmail,
  open,
  collapsed,
  onClose,
  onToggleCollapse,
}: DashboardSidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string): boolean => {
    if (href === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/auth' })
  }

  return (
    <aside
      className={`${styles.sidebar}${open ? ` ${styles.sidebarOpen}` : ''}${
        collapsed ? ` ${styles.sidebarCollapsed}` : ''
      }`}
      aria-label="Dashboard navigation"
    >
      <div className={styles.brandRow}>
        <Link
          href="/dashboard"
          className={styles.brand}
          onClick={onClose}
          aria-label="SellSnap dashboard"
        >
          <span className={styles.brandMark} aria-hidden="true">
            S
          </span>
          <span className={styles.brandName}>SellSnap</span>
        </Link>

        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          ✕
        </button>

        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <ChevronLeftIcon />
        </button>

        <button
          type="button"
          className={styles.expandBtn}
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <nav className={styles.nav}>
        <ul className={styles.list}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`${styles.link}${active ? ` ${styles.linkActive}` : ''}`}
                  aria-current={active ? 'page' : undefined}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className={styles.linkLabel}>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className={styles.userCard}>
        <div className={styles.userInfo} title={collapsed ? userName : undefined}>
          <span className={styles.avatar} aria-hidden="true">
            {getInitials(userName) || 'S'}
          </span>
          <div className={styles.userText}>
            <span className={styles.userName}>{userName}</span>
            {userEmail && <span className={styles.userEmail}>{userEmail}</span>}
          </div>
        </div>

        <button
          type="button"
          className={styles.signOutIconBtn}
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <SignOutIcon />
        </button>

        <button type="button" className={styles.signOutBtn} onClick={handleSignOut}>
          <SignOutIcon />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
