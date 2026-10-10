import styles from './StepFlow.module.css'

export function StepFlow() {
  const steps = [
    {
      number: '01',
      title: 'Snap & Set Your Price',
      description:
        'Upload your product photo, give it a title, and enter the price in Naira. SellSnap instantly generates your unique, branded checkout link.',
    },
    {
      number: '02',
      title: 'Drop Your Link in DMs & Bio',
      description:
        'Place your link in your Instagram bio, TikTok profile, WhatsApp status, or reply directly to buyer DMs with your link instead of bank digits.',
    },
    {
      number: '03',
      title: 'Get Paid with Instant Verification',
      description:
        'Buyers pay securely via Card, Bank Transfer, or USSD. Flutterwave verifies the transaction and settles money directly into your Nigerian bank account.',
    },
  ]

  return (
    <section id="how-it-works" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>How SellSnap turns DMs into sales</h2>
        </div>

        <div className={styles.grid}>
          {steps.map((step) => (
            <div key={step.number} className={styles.card}>
              <span className={styles.stepNumber}>{step.number}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepDescription}>{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
