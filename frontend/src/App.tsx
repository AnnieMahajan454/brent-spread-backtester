import { NavLink, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import { useAsync } from './lib/hooks'
import Overview from './pages/Overview'
import MarketPage from './pages/Market'
import Results from './pages/Results'
import Lab from './pages/Lab'
import Methodology from './pages/Methodology'

const LINKS = [
  { to: '/', label: 'Overview' },
  { to: '/market', label: 'Market data' },
  { to: '/results', label: 'Walk-forward results' },
  { to: '/lab', label: 'Strategy lab' },
  { to: '/methodology', label: 'Methodology' },
]

function ApiStatus() {
  const { data, error, loading } = useAsync(api.health)
  const cls = loading ? '' : error ? 'down' : 'ok'
  const text = loading ? 'connecting' : error ? 'API offline' : `data to ${data!.data_end.slice(0, 10)}`
  return <span className="api-status"><span className={`dot ${cls}`} />{text}</span>
}

export default function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand"><img src="/favicon.svg" alt="" />Brent Spread Backtester</NavLink>
          <nav className="nav" aria-label="Main">
            {LINKS.map(l => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'}>{l.label}</NavLink>
            ))}
          </nav>
          <ApiStatus />
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/results" element={<Results />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/methodology" element={<Methodology />} />
        <Route path="*" element={<Overview />} />
      </Routes>
      <footer className="foot">
        Student project by Annie Mahajan · Python, FastAPI, pandas, scikit-learn, React · Data: NYMEX Brent (BZ) hourly bars via Yahoo Finance · Not investment advice.
      </footer>
    </>
  )
}
