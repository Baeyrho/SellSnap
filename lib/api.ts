import { NextResponse } from 'next/server'

/** API responses must never be cached: they carry session-scoped data (bank details, order lists)
 *  and short-lived payment status. A shared or stale cache would leak data or lie about payment. */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export function errorResponse(
  status: number,
  code: string,
  message: string,
  field?: string
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message, ...(field ? { field } : {}) } },
    { status, headers: NO_STORE_HEADERS }
  )
}

export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status, headers: NO_STORE_HEADERS })
}
