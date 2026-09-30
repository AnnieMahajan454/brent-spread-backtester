import { useEffect, useState } from 'react'

export function Loading({ what = 'data' }: { what?: string }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="state" role="status">
      <div className="spinner" />
      <span>Loading {what}…</span>
      {slow && <span className="caption">The API runs on a free server that sleeps when idle. The first request can take up to a minute.</span>}
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="callout error" role="alert">
      Couldn't reach the backtest API: {message}. Check that the backend is running
      (<code>uvicorn app.main:app</code> in <code>backend/</code>) and try again.
    </div>
  )
}
