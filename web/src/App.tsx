import { lazy, Suspense } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import About from './pages/About'
import { Status } from './components/ui'
import Dashboard from './pages/Dashboard'

const Model = lazy(() => import('./pages/Model'))  // keeps the chart library out of the first load

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/model" element={<Suspense fallback={<Status loading error={null} />}><Model /></Suspense>} />
          <Route path="/about" element={<About />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
