import styles from './Badge.module.css'

interface BadgeProps {
  variant: 'success' | 'warning' | 'error' | 'neutral'
  children: React.ReactNode
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[variant]}`}>
      {children}
    </span>
  )
}
