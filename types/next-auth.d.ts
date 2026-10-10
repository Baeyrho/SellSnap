import { type DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }

  interface User {
    tokenVersion?: number
  }
}

declare module 'next-auth/adapters' {
  interface AdapterUser {
    tokenVersion?: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tokenVersion?: number
    /** Set when the token no longer matches the account (revoked, deleted, or version bumped). */
    invalid?: boolean
  }
}
