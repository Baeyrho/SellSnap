import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

import { Providers } from './providers'

import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'SellSnap',
  description: 'The simplest way for Nigerian social sellers to collect payments.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
