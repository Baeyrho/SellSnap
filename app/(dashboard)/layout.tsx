import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth'

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/auth')
  }

  return <>{children}</>
}
