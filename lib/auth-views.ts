/** The four forms the single auth page can render. */
export type AuthView = 'login' | 'signup' | 'forgot-password' | 'reset-password'

const AUTH_VIEW_TITLES: Record<AuthView, string> = {
  login: 'Sign In - SellSnap',
  signup: 'Create Account - SellSnap',
  'forgot-password': 'Forgot Password - SellSnap',
  'reset-password': 'Reset Password - SellSnap',
}

/** Resolve the ?view= / ?token= aliases — current and legacy — to one form. */
export function resolveAuthView(params: {
  view?: string | null
  token?: string | null
}): AuthView {
  if (params.token || params.view === 'reset-password' || params.view === 'reset') {
    return 'reset-password'
  }
  if (params.view === 'signup' || params.view === 'register') {
    return 'signup'
  }
  if (params.view === 'forgot-password' || params.view === 'forgot') {
    return 'forgot-password'
  }
  return 'login'
}

/** The browser tab title for the form a request resolves to. */
export function authViewTitle(params: {
  view?: string | null
  token?: string | null
}): string {
  return AUTH_VIEW_TITLES[resolveAuthView(params)]
}
