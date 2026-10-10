import Link from 'next/link'

import styles from './HeroSection.module.css'

export function HeroSection() {
  return (
    <section id="hero" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.textContent}>

          <h1 className={styles.headline}>
            Stop sending account numbers in DMs.{' '}
            <span className={styles.highlight}>Get paid in 30 seconds.</span>
          </h1>

          <p className={styles.subheadline}>
            Create a quick product checkout link and collect payments straight to your Nigerian bank account with no fake alert stress.
          </p>

          <div className={styles.ctaGroup}>
            <Link href="/auth?view=signup" className={styles.primaryCta}>
              Create your free link
              <span className={styles.arrow}>→</span>
            </Link>
            <a href="#how-it-works" className={styles.secondaryCta}>
              See how it works
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
