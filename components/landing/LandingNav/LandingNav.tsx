'use client'

import { useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import styles from './LandingNav.module.css'

interface NavItem {
  label: string
  href: string
  sectionId: string
}

// NOTE: Order matches the visual nav order; sectionId maps to each section's HTML id attribute.
const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '#hero', sectionId: 'hero' },
  { label: 'How it works', href: '#how-it-works', sectionId: 'how-it-works' },
  { label: 'Features', href: '#features', sectionId: 'features' },
  { label: 'Calculator', href: '#calculator', sectionId: 'calculator' },
  { label: 'FAQ', href: '#faq', sectionId: 'faq' },
]

export function LandingNav() {
  const [activeId, setActiveId] = useState<string | null>(null)
  // Track which sections are currently intersecting (by id → ratio)
  const intersectingRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const sectionIds = NAV_ITEMS.map((item) => item.sectionId)

    function updateActive() {
      const map = intersectingRef.current
      // Find the section with the highest intersection ratio currently visible
      let bestId: string | null = null
      let bestRatio = 0

      for (const id of sectionIds) {
        const ratio = map.get(id) ?? 0
        if (ratio > bestRatio) {
          bestRatio = ratio
          bestId = id
        }
      }

      // Only highlight a link if at least 5% of the section is visible
      setActiveId(bestRatio >= 0.05 ? bestId : null)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          intersectingRef.current.set(entry.target.id, entry.intersectionRatio)
        }
        updateActive()
      },
      {
        // rootMargin shrinks the observation zone slightly from the top so that
        // the next section triggers only when meaningfully scrolled into view.
        rootMargin: '-10% 0px -10% 0px',
        threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0],
      }
    )

    for (const id of sectionIds) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link href="/" className={styles.brand}>
          SellSnap
        </Link>

        <nav className={styles.navLinks} aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.sectionId}
              href={item.href}
              className={`${styles.link}${activeId === item.sectionId ? ` ${styles.linkActive}` : ''}`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className={styles.actions}>
          <Link href="/auth" className={styles.loginLink}>
            Sign in
          </Link>
          <Link href="/auth?view=signup" className={styles.ctaBtn}>
            Start selling free
          </Link>
        </div>
      </div>
    </header>
  )
}
