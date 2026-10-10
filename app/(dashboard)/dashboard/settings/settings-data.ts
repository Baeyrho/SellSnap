import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Shared by /dashboard/settings and /dashboard/settings/[section] so the
// Settings sub-pages all read the same seller fields.
export async function getSettingsUser() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/auth')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      displayName: true,
      businessName: true,
      businessBio: true,
      businessLocation: true,
      whatsappNumber: true,
      phoneNumber: true,
      logoUrl: true,
      bankCode: true,
      accountNumber: true,
      createdAt: true,
    },
  })

  if (!user) {
    redirect('/auth')
  }

  return user
}