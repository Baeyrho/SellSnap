import { formatNaira } from '@/lib/kobo'
import { Badge } from '@/components/ui/Badge/Badge'

import type { OrderWithProduct } from '@/types'

import styles from './OrderTable.module.css'

interface OrderTableProps {
  orders: OrderWithProduct[]
}

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'SUCCESS':
      return 'success'
    case 'PENDING':
      return 'warning'
    case 'FAILED':
      return 'error'
    default:
      return 'neutral'
  }
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function EmptyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-3.5-2-2.5 2-2.5-2L7 21V4a1 1 0 0 1 1-1" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  )
}

export function OrderTable({ orders }: OrderTableProps) {
  if (orders.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon} aria-hidden="true">
          <EmptyIcon />
        </span>
        <p className={styles.emptyText}>No orders yet</p>
        <p className={styles.emptyHint}>
          Orders will appear here when customers purchase your products.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.th}>Product</th>
            <th className={styles.th}>Amount</th>
            <th className={styles.th}>Status</th>
            <th className={styles.th}>Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className={styles.row}>
              <td className={styles.td} data-label="Product">
                <div className={styles.productCell}>
                  <span className={styles.productName}>{order.product.name}</span>
                  {order.customerEmail && (
                    <span className={styles.customerEmail}>{order.customerEmail}</span>
                  )}
                </div>
              </td>
              <td className={styles.td} data-label="Amount">
                <span className={styles.amount}>{formatNaira(order.amountKobo)}</span>
              </td>
              <td className={styles.td} data-label="Status">
                <Badge variant={statusVariant(order.status)}>{order.status}</Badge>
              </td>
              <td className={styles.td} data-label="Date">
                <span className={styles.date}>{formatDate(order.createdAt)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
