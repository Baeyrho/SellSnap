import type { Metadata } from 'next'

import { LandingNav } from '@/components/landing/LandingNav/LandingNav'
import { HeroSection } from '@/components/landing/HeroSection/HeroSection'
import { StepFlow } from '@/components/landing/StepFlow/StepFlow'
import { FeatureGrid } from '@/components/landing/FeatureGrid/FeatureGrid'
import { EarningsCalculator } from '@/components/landing/EarningsCalculator/EarningsCalculator'
import { FaqSection } from '@/components/landing/FaqSection/FaqSection'
import { CtaBanner } from '@/components/landing/CtaBanner/CtaBanner'
import { LandingFooter } from '@/components/landing/LandingFooter/LandingFooter'

import styles from './page.module.css'

export const metadata: Metadata = {
  title: 'SellSnap — Instant Product Payment Links for Nigerian Sellers',
  description:
    'Turn your WhatsApp, Instagram, and TikTok chats into direct sales. Create a fast product link, collect customer payments, and receive direct bank settlements with automatic Flutterwave verification.',
}

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <LandingNav />
      <main>
        <HeroSection />
        <StepFlow />
        <FeatureGrid />
        <EarningsCalculator />
        <FaqSection />
        <CtaBanner />
      </main>
      <LandingFooter />
    </div>
  )
}
