'use client'

import { useId, useState } from 'react'

import styles from './ProfileNotifications.module.css'

interface ProfileNotificationsProps {
  sellerEmail: string
  phoneNumber?: string | null
  whatsappNumber?: string | null
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function SmsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.99.59 3.93 1.7 5.58L2 22l4.67-1.78a9.88 9.88 0 0 0 5.37 1.55h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.79 14.07c-.24.68-1.4 1.25-1.95 1.33-.51.08-1.18.11-3.41-.81-2.86-1.19-4.7-4.1-4.84-4.29-.15-.19-1.16-1.54-1.16-2.94 0-1.4.73-2.09 1-2.37.26-.28.57-.35.77-.35.2 0 .39.01.56.02.18.01.42-.07.66.5.24.58.83 2.03.9 2.18.08.15.13.33.03.53-.1.2-.15.33-.3.51-.15.18-.32.4-.46.54-.15.15-.31.31-.13.62.18.3 1.1 1.81 2.37 2.94 1.63 1.45 3.01 1.9 3.44 2.11.43.21.68.18.93-.11.26-.29 1.1-1.28 1.4-1.72.3-.44.59-.37.99-.22.4.15 2.53 1.19 2.97 1.41.43.22.72.33.83.51.11.18.11 1.05-.13 1.73z" />
    </svg>
  )
}

interface ToggleProps {
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (val: boolean) => void
  label: string
}

function Toggle({ id, checked, disabled = false, onChange, label }: ToggleProps) {
  return (
    <label
      htmlFor={id}
      className={`${styles.toggle} ${disabled ? styles.toggleDisabled : ''}`}
      title={disabled ? 'Coming soon' : checked ? 'Turn off' : 'Turn on'}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className={styles.toggleTrack} />
    </label>
  )
}

export function ProfileNotifications({
  sellerEmail,
  phoneNumber,
  whatsappNumber,
}: ProfileNotificationsProps) {
  const baseId = useId()

  const [emailEnabled, setEmailEnabled] = useState(true)
  const [inAppEnabled, setInAppEnabled] = useState(true)

  return (
    <section className={styles.card} aria-label="Payment notification preferences">
      <div className={styles.channelsList}>
        {/* Email Notifications */}
        <div className={`${styles.channelItem} ${!emailEnabled ? styles.channelItemOff : ''}`}>
          <div className={styles.channelHeader}>
            <div className={styles.channelTitleRow}>
              <span className={styles.channelIcon} aria-hidden="true">
                <MailIcon />
              </span>
              <div>
                <h3 className={styles.channelName}>Email Payment Receipts</h3>
                <p className={styles.channelRecipient}>Sending to: {sellerEmail}</p>
              </div>
            </div>
            <Toggle
              id={`${baseId}-email`}
              checked={emailEnabled}
              onChange={setEmailEnabled}
              label="Toggle email payment receipt notifications"
            />
          </div>
          <p className={styles.channelDesc}>
            Instant payment receipts and customer order fulfillment details are sent automatically to your verified email address upon successful transaction verification.
          </p>
        </div>

        {/* In-App Notifications */}
        <div className={`${styles.channelItem} ${!inAppEnabled ? styles.channelItemOff : ''}`}>
          <div className={styles.channelHeader}>
            <div className={styles.channelTitleRow}>
              <span className={styles.channelIcon} aria-hidden="true">
                <BellIcon />
              </span>
              <div>
                <h3 className={styles.channelName}>In-App Dashboard Settlement</h3>
                <p className={styles.channelRecipient}>Active on your dashboard</p>
              </div>
            </div>
            <Toggle
              id={`${baseId}-inapp`}
              checked={inAppEnabled}
              onChange={setInAppEnabled}
              label="Toggle in-app dashboard settlement notifications"
            />
          </div>
          <p className={styles.channelDesc}>
            Immediate balance and order status updates on your SellSnap overview screen as soon as Flutterwave confirms payment settlement.
          </p>
        </div>

        {/* SMS Notifications — Coming Soon */}
        <div className={`${styles.channelItem} ${styles.channelUpcoming}`}>
          <div className={styles.channelHeader}>
            <div className={styles.channelTitleRow}>
              <span className={styles.channelIcon} aria-hidden="true">
                <SmsIcon />
              </span>
              <div>
                <h3 className={styles.channelName}>SMS Transaction Alerts</h3>
                <p className={styles.channelRecipient}>
                  {phoneNumber ? `Target: ${phoneNumber}` : 'Nigerian mobile phone number required'}
                </p>
              </div>
            </div>
            <Toggle
              id={`${baseId}-sms`}
              checked={false}
              disabled
              onChange={() => {}}
              label="SMS notifications — coming soon"
            />
          </div>
          <p className={styles.channelDesc}>
            Direct SMS text alerts to your mobile phone when bank settlements are completed. Telecom SMS gateway integration is currently in development.
          </p>
        </div>

        {/* WhatsApp Notifications — Coming Soon */}
        <div className={`${styles.channelItem} ${styles.channelUpcoming}`}>
          <div className={styles.channelHeader}>
            <div className={styles.channelTitleRow}>
              <span className={styles.channelIcon} aria-hidden="true">
                <WhatsAppIcon />
              </span>
              <div>
                <h3 className={styles.channelName}>WhatsApp Business Notifications</h3>
                <p className={styles.channelRecipient}>
                  {whatsappNumber ? `Target: ${whatsappNumber}` : 'WhatsApp number required'}
                </p>
              </div>
            </div>
            <Toggle
              id={`${baseId}-whatsapp`}
              checked={false}
              disabled
              onChange={() => {}}
              label="WhatsApp notifications — coming soon"
            />
          </div>
          <p className={styles.channelDesc}>
            Automated WhatsApp order receipts and fulfillment notifications. This requires the upcoming WhatsApp Business API gateway rollout.
          </p>
        </div>
      </div>

      <div className={styles.policyNote}>
        <p className={styles.policyTitle}>Reliable Payment Notifications</p>
        <p className={styles.policyText}>
          Because payment routing goes directly to your bank account via Flutterwave subaccounts, email and dashboard notifications are always guaranteed with zero delay.
        </p>
      </div>
    </section>
  )
}
