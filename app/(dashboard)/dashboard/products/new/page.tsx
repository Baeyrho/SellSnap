import { PageShell } from '@/components/layout/PageShell/PageShell'
import { ProductForm } from '@/components/product/ProductForm/ProductForm'

export const metadata = {
  title: 'New Product - SellSnap',
}

export default function NewProductPage() {
  return (
    <PageShell
      title="Create Product"
      subtitle="Add a new product to your store."
      backHref="/dashboard/products"
      backLabel="Cancel"
      backVariant="secondary"
    >
      <ProductForm />
    </PageShell>
  )
}
