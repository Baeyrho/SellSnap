import Link from 'next/link'

import styles from './CtaBanner.module.css'

export function CtaBanner() {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.content}>
            <span className={styles.badge}>Get Started in Under 60 Seconds</span>
            <h2 className={styles.title}>Ready to make selling on social media effortless?</h2>
            <p className={styles.subtitle}>
              Join Nigerian social sellers using SellSnap to collect direct bank payments with automatic verification.
            </p>
            <div className={styles.actions}>
              <Link href="/auth?view=signup" className={styles.primaryBtn}>
                Create your free account
                <span className={styles.arrow}>→</span>
              </Link>
              <Link href="/auth" className={styles.secondaryBtn}>
                Already have an account? Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
