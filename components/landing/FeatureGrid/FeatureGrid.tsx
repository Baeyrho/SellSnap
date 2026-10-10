import styles from './FeatureGrid.module.css'

export function FeatureGrid() {
    const features = [
      {
        icon: '🛡️',
        title: 'Zero Fake Alert Scams',
        description:
          'Say goodbye to fake transfer screenshots. Every transaction is verified directly with Flutterwave before an order is marked successful.',
      },
      {
        icon: '🏦',
        title: 'Direct Nigerian Bank Payouts',
        description:
          'Works with all Nigerian commercial banks and fintechs (GTB, Access, Zenith, OPay, PalmPay, Kuda). Payments route straight to your bank account.',
      },
      {
        icon: '⚡',
        title: 'Instant 30-Second Setup',
        description:
          'No complicated Shopify dashboards or monthly fees. Simply enter your product title, price, and bank details, and you are ready to sell.',
      },
      {
        icon: '📩',
        title: 'Automated Email Receipts',
        description:
          'Both you and your buyer receive immediate email confirmations with exact transaction reference codes and delivery details.',
      },
    ];

  return (
    <section id="features" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.header}>
          <p className={styles.tag}>Built for Social Commerce</p>
          <h2 className={styles.title}>Everything you need to close sales faster</h2>
        </div>

        <div className={styles.grid}>
          {features.map((item, index) => (
            <div key={index} className={styles.card}>
              <div className={styles.iconCircle}>{item.icon}</div>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className={styles.cardText}>{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
