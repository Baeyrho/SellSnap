'use client'

import { useState } from 'react'

import styles from './FaqSection.module.css'

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const faqs = [
    {
      question: 'Do I need a registered CAC company or business account?',
      answer:
        'No! You can start selling immediately using your regular personal Nigerian bank account (e.g. GTBank, Access, Zenith, Kuda, OPay, PalmPay). No CAC registration or paperwork is required.',
    },
    {
      question: 'How do payments get into my bank account?',
      answer:
        'SellSnap is integrated with Flutterwave Subaccounts. When a buyer opens your link and pays, Flutterwave routes the settlement directly into the bank account you added during registration.',
    },
    {
      question: 'How do I avoid fake transfer alert scams?',
      answer:
        'You never need to check unverified bank SMS or ask buyers for screenshots. Flutterwave authoritatively verifies the payment with the central banking switch. Only genuine, confirmed payments update your SellSnap dashboard and trigger order receipt emails.',
    },
    {
      question: 'What payment options can my buyers use?',
      answer:
        'Buyers can pay via Nigerian Debit Cards (Mastercard, Visa, Verve), Direct Bank Transfer, or USSD code from any Nigerian bank.',
    },
    {
      question: 'How much does SellSnap cost?',
      answer:
        'SellSnap is 100% free with ₦0 monthly subscriptions and ₦0 setup fees. You can create and share unlimited product links for all your items.',
    },
  ]

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <section id="faq" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>Frequently Asked Questions</h2>
        </div>

        <div className={styles.faqList}>
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index
            return (
              <div key={index} className={`${styles.faqItem} ${isOpen ? styles.itemOpen : ''}`}>
                <button
                  type="button"
                  className={styles.questionBtn}
                  onClick={() => toggle(index)}
                  aria-expanded={isOpen}
                >
                  <span className={styles.questionText}>{faq.question}</span>
                  <span className={styles.toggleIcon}>{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <div className={styles.answer}>
                    <p className={styles.answerText}>{faq.answer}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
