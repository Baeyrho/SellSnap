import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardShell } from '@/components/layout/DashboardShell/DashboardShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  const user = session?.user?.id
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, email: true },
      })
    : null

  return (
    <DashboardShell
      userName={
        user?.name || session?.user?.name || session?.user?.email || 'Seller'
      }
      userEmail={user?.email ?? session?.user?.email ?? undefined}
    >
      {children}
    </DashboardShell>
  )
}
