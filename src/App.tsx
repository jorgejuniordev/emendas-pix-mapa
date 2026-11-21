import { Suspense, lazy, useEffect, useState } from 'react'
import './App.css'
import type { Dataset, Theme } from './data'
import type { Mesh } from './MapView'
import type { MapParams } from './MapPage'
import { Home } from './Home'

const MapPage = lazy(() => import('./MapPage').then((m) => ({ default: m.MapPage })))

function useStoredState<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key) as T | null
    return stored && allowed.includes(stored) ? stored : fallback
  })
  useEffect(() => localStorage.setItem(key, value), [key, value])
  return [value, setValue] as const
}

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

type Route = { view: 'home' } | { view: 'mapa'; params: MapParams; key: string }

function parseRoute(hash: string, data: Dataset | null): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  if (path !== 'mapa') return { view: 'home' }
  const q = new URLSearchParams(query)
  const parl = q.has('parl') ? Number(q.get('parl')) : null
  const year = q.has('ano') ? Number(q.get('ano')) : null
  return {
    view: 'mapa',
    key: query,
    params: {
      uf: q.get('uf') ?? '',
      parl: parl !== null && data?.parlamentares[parl] ? parl : null,
      year: year !== null && data?.meta.anos.includes(year) ? year : null,
    },
  }
}

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [mesh, setMesh] = useState<Mesh | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState(window.location.hash)
  const [theme, setTheme] = useStoredState<Theme>(
    'tema',
    ['claro', 'escuro'],
    prefersDark ? 'escuro' : 'claro',
  )
  const toggleTheme = () => setTheme(theme === 'claro' ? 'escuro' : 'claro')
  const route = parseRoute(hash, data)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    fetch('data/emendas.json')
      .then((r) => r.json() as Promise<Dataset>)
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const needsMesh = route.view === 'mapa'
  useEffect(() => {
    if (!needsMesh || mesh) return
    fetch('data/municipios.geojson')
      .then((r) => r.json() as Promise<Mesh>)
      .then(setMesh)
      .catch((e: unknown) => setError(String(e)))
  }, [needsMesh, mesh])

  if (error) return <div className="loading">Erro ao carregar dados: {error}</div>
  if (!data) return <div className="loading">Carregando emendas…</div>

  const loadingMap = <div className="loading">Carregando 5.570 municípios…</div>
  return (
    <>
      {/* Kept mounted so the ranking filters survive a round trip to the map */}
      <div hidden={route.view !== 'home'}>
        <Home data={data} theme={theme} onToggleTheme={toggleTheme} />
      </div>
      {route.view === 'mapa' &&
        (mesh ? (
          <Suspense fallback={loadingMap}>
            <MapPage
              key={route.key}
              data={data}
              mesh={mesh}
              initial={route.params}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          </Suspense>
        ) : (
          loadingMap
        ))}
    </>
  )
}
