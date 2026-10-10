'use client'

import { useState } from 'react'
import Link from 'next/link'

import styles from './EarningsCalculator.module.css'

export function EarningsCalculator() {
  const [salePrice, setSalePrice] = useState(15000)
  const [salesPerMonth, setSalesPerMonth] = useState(20)

  const presets = [5000, 15000, 35000, 75000]

  const totalMonthlyVolume = salePrice * salesPerMonth
  const formattedMonthly = `₦${totalMonthlyVolume.toLocaleString('en-NG')}`
  const formattedSalePrice = `₦${salePrice.toLocaleString('en-NG')}`

  return (
    <section id="calculator" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Calculate your earnings on SellSnap</h2>
        </div>

        <div className={styles.calculatorCard}>
          <div className={styles.inputColumn}>
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label htmlFor="calculator-item-price" className={styles.label}>
                  Average Item Price
                </label>
                <span className={styles.fieldValue}>{formattedSalePrice}</span>
              </div>
              <input
                id="calculator-item-price"
                type="range"
                min="1000"
                max="100000"
                step="1000"
                value={salePrice}
                onChange={(e) => setSalePrice(Number(e.target.value))}
                className={styles.rangeInput}
              />
              <div className={styles.presetGroup}>
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`${styles.presetBtn} ${salePrice === preset ? styles.presetActive : ''}`}
                    onClick={() => setSalePrice(preset)}
                  >
                    ₦{preset.toLocaleString('en-NG')}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label htmlFor="calculator-sales-per-month" className={styles.label}>
                  Estimated Sales Per Month
                </label>
                <span className={styles.fieldValue}>{salesPerMonth} orders</span>
              </div>
              <input
                id="calculator-sales-per-month"
                type="range"
                min="1"
                max="100"
                step="1"
                value={salesPerMonth}
                onChange={(e) => setSalesPerMonth(Number(e.target.value))}
                className={styles.rangeInput}
              />
            </div>
          </div>

          <div className={styles.summaryColumn}>
            <p className={styles.summaryLabel}>Estimated Monthly Payout</p>
            <p className={styles.summaryTotal}>{formattedMonthly}</p>
            <p className={styles.summaryNote}>
              Settled directly into your Nigerian bank account via Flutterwave Subaccounts.
            </p>

            <div className={styles.feeBreakdown}>
              <div className={styles.feeRow}>
                <span>SellSnap Monthly Fee</span>
                <span className={styles.feeFree}>₦0 (Free Forever)</span>
              </div>
              <div className={styles.feeRow}>
                <span>Product Listing Fee</span>
                <span className={styles.feeFree}>₦0 (Unlimited Links)</span>
              </div>
              <div className={styles.feeRow}>
                <span>Settlement Speed</span>
                <span className={styles.feeHighlight}>Direct to Bank</span>
              </div>
            </div>

            <Link href="/auth?view=signup" className={styles.calcCta}>
              Start collecting ₦{salePrice.toLocaleString('en-NG')} orders
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
