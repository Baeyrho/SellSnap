import styles from './Skeleton.module.css'

interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string
  height?: string
  className?: string
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className,
}: SkeletonProps) {
  const style: React.CSSProperties = {}
  if (width) style.width = width
  if (height) style.height = height

  return (
    <span
      className={`${styles.skeleton} ${styles[variant]} ${className ?? ''}`}
      style={Object.keys(style).length > 0 ? style : undefined}
    />
  )
}
