'use client'

import { useId, useState } from 'react'
import styles from './Input.module.css'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  showPasswordToggle?: boolean
}

export function Input({
  label,
  error,
  className,
  id,
  type,
  showPasswordToggle,
  ...props
}: InputProps) {
  const generatedId = useId()
  const inputId = id || (label ? `input-${generatedId}` : undefined)
  const errorId = error && inputId ? `${inputId}-error` : undefined
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)

  const isPasswordType = type === 'password'
  const shouldShowToggle = isPasswordType && showPasswordToggle
  const effectiveType = shouldShowToggle && isPasswordVisible ? 'text' : type

  return (
    <div className={styles.wrapper}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      )}
      <div className={styles.inputContainer}>
        <input
          id={inputId}
          type={effectiveType}
          className={`${styles.input} ${shouldShowToggle ? styles.inputWithToggle : ''} ${error ? styles.error : ''} ${className ?? ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...props}
        />
        {shouldShowToggle && (
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setIsPasswordVisible((prev) => !prev)}
            onMouseDown={(e) => e.preventDefault()}
            aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
            title={isPasswordVisible ? 'Hide password' : 'Show password'}
          >
            <span className={styles.toggleText}>
              {isPasswordVisible ? 'Hide' : 'Show'}
            </span>
          </button>
        )}
      </div>
      {error && (
        <span id={errorId} className={styles.errorText} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
