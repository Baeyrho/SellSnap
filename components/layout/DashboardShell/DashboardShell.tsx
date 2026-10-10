'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'

import { DashboardSidebar } from '@/components/layout/DashboardSidebar/DashboardSidebar'
import { DashboardHeader } from '@/components/layout/DashboardHeader/DashboardHeader'

import styles from './DashboardShell.module.css'

interface DashboardShellProps {
  userName: string
  userEmail?: string
  children: React.ReactNode
}

const SIDEBAR_STORAGE_KEY = 'sellsnap.sidebar.collapsed'

const subscribeToCollapsed = (): (() => void) => () => {}

const serverCollapsed = (): boolean => false

const readCollapsed = (): boolean => {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    if (stored !== null) return stored === '1'
  } catch {
    // localStorage unavailable — fall through to breakpoint default
  }

  // NOTE: Tablet widths default to a collapsed sidebar so content gets room.
  return window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches
}

export function DashboardShell({
  userName,
  userEmail,
  children,
}: DashboardShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const storedCollapsed = useSyncExternalStore(
    subscribeToCollapsed,
    readCollapsed,
    serverCollapsed
  )
  const [writtenCollapsed, setWrittenCollapsed] = useState<boolean | null>(null)
  const collapsed = writtenCollapsed ?? storedCollapsed
  const pathname = usePathname()

  // Close the drawer when the route changes, adjusting state during render with a previous-value
  // guard instead of an effect: the drawer is already closed by the time the new route commits.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setMenuOpen(false)
  }

  useEffect(() => {
    if (!menuOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handleChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setMenuOpen(false)
      }
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  const handleToggleCollapse = () => {
    const next = !collapsed
    setWrittenCollapsed(next)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // localStorage unavailable — state still applies for this session
    }
  }

  return (
    <div className={styles.shell}>
      <DashboardSidebar
        userName={userName}
        userEmail={userEmail}
        open={menuOpen}
        collapsed={collapsed}
        onClose={() => setMenuOpen(false)}
        onToggleCollapse={handleToggleCollapse}
      />

      {menuOpen && (
        <button
          type="button"
          className={styles.overlay}
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation menu"
        />
      )}

      <div className={styles.main}>
        <DashboardHeader
          onMenuClick={() => setMenuOpen(true)}
          menuOpen={menuOpen}
        />
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}
