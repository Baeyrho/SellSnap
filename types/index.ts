import type { Product, Order } from '@prisma/client'

/** Order with product info attached */
export interface OrderWithProduct extends Order {
  product: Pick<Product, 'id' | 'name' | 'slug' | 'imageUrl' | 'priceKobo'>
}

/** Standard API success response */
export interface ApiSuccessResponse<T> {
  success: true
  data: T
}

/** Standard API error response */
export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
    field?: string
  }
}

/** Union type for any API response */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse
