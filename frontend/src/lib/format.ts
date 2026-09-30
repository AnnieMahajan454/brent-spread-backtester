const MONTHS: Record<string, string> = {
  F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr', K: 'May', M: 'Jun',
  N: 'Jul', Q: 'Aug', U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec',
}

/** "Z26" -> "Dec-26" */
export const contractName = (c: string) => `${MONTHS[c[0]] ?? c[0]}-${c.slice(1)}`

/** +$1,234 / −$1,234 */
export const money = (v: number) =>
  `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`

/** $12k style for axes */
export const moneyK = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `${Math.round(a)}`
  return `${v < 0 ? '−' : ''}$${s}`
}

export const signClass = (v: number) => (v >= 0 ? 'pos' : 'neg')

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export const dateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
