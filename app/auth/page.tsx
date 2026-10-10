import type { Metadata } from 'next'

import { authViewTitle } from '@/lib/auth-views'

import { AuthCard } from '@/components/auth/AuthCard/AuthCard'

interface AuthPageProps {
  searchParams: Promise<{ view?: string; token?: string }>
}

export async function generateMetadata({ searchParams }: AuthPageProps): Promise<Metadata> {
  const { view, token } = await searchParams
  return { title: authViewTitle({ view, token }) }
}

// AuthCard reads ?view= via useSearchParams, which cannot be statically prerendered.
// Keep the page dynamic so the correct form is rendered server-side for each request.
export const dynamic = 'force-dynamic'

export default function AuthPage() {
  return <AuthCard />
}
