import { redirect } from 'next/navigation'

export default function LegacyProductsPage() {
  redirect('/dashboard/products')
}
