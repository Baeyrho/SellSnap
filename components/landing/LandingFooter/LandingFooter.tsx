import Link from 'next/link'

import styles from './LandingFooter.module.css'

export function LandingFooter() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.top}>
          <div className={styles.brandCol}>
            <Link href="/" className={styles.brand}>
              SellSnap
            </Link>
            <p className={styles.tagline}>
              Link-based commerce built for Nigerian social sellers. Instant checkout, automatic Flutterwave verification, direct bank settlement.
            </p>
          </div>

          <div className={styles.linksGrid}>
            <div className={styles.linkCol}>
              <h4 className={styles.colTitle}>Product</h4>
              <a href="#how-it-works" className={styles.link}>How It Works</a>
              <a href="#features" className={styles.link}>Features</a>
              <a href="#calculator" className={styles.link}>Earnings Calculator</a>
              <a href="#faq" className={styles.link}>FAQ</a>
            </div>

            <div className={styles.linkCol}>
              <h4 className={styles.colTitle}>Account</h4>
              <Link href="/auth" className={styles.link}>Sign in</Link>
              <Link href="/auth?view=signup" className={styles.link}>Create account</Link>
              <Link href="/auth?view=forgot-password" className={styles.link}>Reset password</Link>
            </div>

            <div className={styles.linkCol}>
              <h4 className={styles.colTitle}>Legal & Compliance</h4>
              <Link href="/privacy" className={styles.link}>Privacy Policy (NDPR)</Link>
              <Link href="/terms" className={styles.link}>Terms of Service</Link>
              <span className={styles.partnerNote}>🔒 Powered by Flutterwave</span>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <p className={styles.copyright}>
            © {currentYear} SellSnap. All rights reserved. Built for Nigerian social sellers.
          </p>
          <div className={styles.legalLinks}>
            <Link href="/privacy" className={styles.legalLink}>Privacy</Link>
            <span>•</span>
            <Link href="/terms" className={styles.legalLink}>Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
