import Link from 'next/link'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatNaira } from '@/lib/kobo'
import { PageShell } from '@/components/layout/PageShell/PageShell'
import { OrderTable } from '@/components/order/OrderTable/OrderTable'
import { Button } from '@/components/ui/Button/Button'

import styles from './dashboard.module.css'

export const metadata = {
  title: 'Dashboard - SellSnap',
}

function BankIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 9.5V17M9.5 9.5V17M14.5 9.5V17M19 9.5V17" />
      <path d="M3 17h18M4 20h16" />
    </svg>
  )
}

function RevenueIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  )
}

function OrdersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-3.5-2-2.5 2-2.5-2L7 21V4a1 1 0 0 1 1-1" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  )
}

function ProductsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M20.6 7.2 12 12 3.4 7.2" />
      <path d="M12 12v9" />
      <path d="M3.4 7.2 12 3l8.6 4.2v9.6L12 21l-8.6-4.2z" />
    </svg>
  )
}

export default async function DashboardPage() {
  const session = await auth()
  const sellerId = session!.user.id

  const [productCount, orderCount, revenueResult, recentOrders, seller] = await Promise.all([
    prisma.product.count({ where: { sellerId, status: { not: 'DELETED' } } }),
    prisma.order.count({ where: { sellerId, status: 'SUCCESS' } }),
    prisma.order.aggregate({
      where: { sellerId, status: 'SUCCESS' },
      _sum: { amountKobo: true },
    }),
    prisma.order.findMany({
      where: { sellerId },
      include: {
        product: {
          select: { id: true, name: true, slug: true, imageUrl: true, priceKobo: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.user.findUnique({
      where: { id: sellerId },
      select: { bankCode: true, accountNumber: true },
    }),
  ])

  const totalRevenue = revenueResult._sum.amountKobo ?? 0
  const isBankConfigured = Boolean(seller?.bankCode && seller?.accountNumber)

  return (
    <PageShell
      title={`Welcome back, ${session?.user?.name || 'Seller'}`}
      subtitle="Here's what's happening with your store."
    >
      {!isBankConfigured && (
        <div className={styles.setupBanner}>
          <span className={styles.setupIcon} aria-hidden="true">
            <BankIcon />
          </span>
          <div className={styles.setupText}>
            <h3 className={styles.setupTitle}>Set up your payout bank account</h3>
            <p className={styles.setupDescription}>
              Add your Nigerian bank details so customer payments land directly in your account.
            </p>
          </div>
          <Link href="/dashboard/settings/payout" className={styles.setupAction}>
            <Button variant="primary">Set Up Bank Details</Button>
          </Link>
        </div>
      )}
      <div className={styles.grid}>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Total Revenue</span>
            <span className={styles.statIcon} aria-hidden="true">
              <RevenueIcon />
            </span>
          </div>
          <p className={styles.statValuePrimary}>{formatNaira(totalRevenue)}</p>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Completed Orders</span>
            <span className={styles.statIcon} aria-hidden="true">
              <OrdersIcon />
            </span>
          </div>
          <p className={styles.statValue}>{orderCount}</p>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statLabel}>Products</span>
            <span className={styles.statIcon} aria-hidden="true">
              <ProductsIcon />
            </span>
          </div>
          <p className={styles.statValue}>{productCount}</p>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Orders</h2>
          <Link href="/dashboard/orders" className={styles.sectionLink}>
            View all
          </Link>
        </div>
        <OrderTable orders={recentOrders} />
      </div>
    </PageShell>
  )
}
