'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

import { formatNaira } from '@/lib/kobo'

import styles from './confirm.module.css'

interface OrderStatus {
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  productName: string
  productImage: string
  amountKobo: number
  transactionRef: string
}

function CheckoutContent() {
  const searchParams = useSearchParams()
  const txRef = searchParams.get('tx_ref')

  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pollCount, setPollCount] = useState(0)

  useEffect(() => {
    if (!txRef) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout/status/${txRef}`)
        if (!res.ok) {
          setError('Order not found.')
          return
        }

        const json = await res.json()
        const data = json.data as OrderStatus
        setOrderStatus(data)

        if (data.status === 'PENDING' && pollCount < 30) {
          setTimeout(() => setPollCount((c) => c + 1), 3000)
        }
      } catch {
        setError('Unable to check order status.')
      }
    }

    poll()
  }, [txRef, pollCount])

  // A missing tx_ref is derived instead of being written by the effect: it is a pure function
  // of the URL, so rendering it needs no state update and no extra commit.
  const errorMessage = txRef === null ? 'Missing transaction reference.' : error

  if (errorMessage) {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <div className={styles.iconError}>✕</div>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>{errorMessage}</p>
        </div>
      </main>
    )
  }

  if (!orderStatus) {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <div className={styles.spinner} />
          <h1 className={styles.title}>Checking payment...</h1>
        </div>
      </main>
    )
  }

  if (orderStatus.status === 'PENDING') {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <div className={styles.spinner} />
          <h1 className={styles.title}>Processing payment...</h1>
          <p className={styles.message}>
            Please wait while we confirm your payment. This usually takes a few seconds.
          </p>
        </div>
      </main>
    )
  }

  if (orderStatus.status === 'FAILED') {
    return (
      <main className={styles.container}>
        <div className={styles.card}>
          <div className={styles.iconError}>✕</div>
          <h1 className={styles.title}>Payment Failed</h1>
          <p className={styles.message}>
            Your payment could not be processed. Please try again.
          </p>
          <p className={styles.ref}>Ref: {orderStatus.transactionRef}</p>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconSuccess}>✓</div>
        <h1 className={styles.title}>Payment Successful!</h1>
        <div className={styles.productInfo}>
          <img
            src={orderStatus.productImage}
            alt={orderStatus.productName}
            className={styles.productImage}
          />
          <p className={styles.productName}>{orderStatus.productName}</p>
          <p className={styles.amount}>{formatNaira(orderStatus.amountKobo)}</p>
        </div>
        <p className={styles.message}>
          The seller has been notified and will reach out to you.
        </p>
        <p className={styles.ref}>Ref: {orderStatus.transactionRef}</p>
        <Link href="/" className={styles.homeLink}>
          Back to SellSnap
        </Link>
      </div>
    </main>
  )
}

export default function CheckoutConfirmPage() {
  return (
    <Suspense fallback={
      <main className={styles.container}>
        <div className={styles.card}>
          <div className={styles.spinner} />
          <h1 className={styles.title}>Loading...</h1>
        </div>
      </main>
    }>
      <CheckoutContent />
    </Suspense>
  )
}
