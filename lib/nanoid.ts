import { nanoid } from 'nanoid'

/** Generate a URL-safe product slug (10 characters) */
export function generateSlug(): string {
  return nanoid(10)
}
