// Single source of truth for the Settings sub-pages. Each key maps to one
// route segment under /dashboard/settings/[section], so the nav, the page
// title, and the conditional section render can never drift apart.
export const PROFILE_SECTIONS = [
  { key: 'business', label: 'Business Profile' },
  { key: 'account', label: 'Account Details' },
  { key: 'payout', label: 'Bank & Payouts' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'security', label: 'Security' },
] as const

export type ProfileSectionKey = (typeof PROFILE_SECTIONS)[number]['key']