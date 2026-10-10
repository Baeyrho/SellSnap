import { redirect } from 'next/navigation'

export default function LegacyNewProductPage() {
  redirect('/dashboard/products/new')
}
