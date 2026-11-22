import { Suspense, lazy, useEffect, useState } from 'react'
import './App.css'
import type { Dataset, Theme } from './data'
import type { Mesh } from './MapView'
import type { MapParams } from './mapStats'
import { Home } from './Home'

const MapPage = lazy(() => import('./MapPage').then((m) => ({ default: m.MapPage })))

const THEMES: readonly Theme[] = ['claro', 'escuro']
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

type Route = { view: 'home' } | { view: 'mapa'; params: MapParams; key: string }

function useStoredState<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key) as T | null
    return stored && allowed.includes(stored) ? stored : fallback
  })
  useEffect(() => localStorage.setItem(key, value), [key, value])
  return [value, setValue] as const
}

function useTheme() {
  const [theme, setTheme] = useStoredState<Theme>('tema', THEMES, prefersDark ? 'escuro' : 'claro')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const toggleTheme = () => setTheme(theme === 'claro' ? 'escuro' : 'claro')
  return [theme, toggleTheme] as const
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return hash
}

function useJson<T>(url: string, enabled: boolean, onError: (message: string) => void): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    if (!enabled || value) return
    fetch(url)
      .then((r) => r.json() as Promise<T>)
      .then(setValue)
      .catch((e: unknown) => onError(String(e)))
  }, [url, enabled, value, onError])
  return value
}

function parseParl(q: URLSearchParams, data: Dataset | null): number | null {
  if (!q.has('parl')) return null
  const parl = Number(q.get('parl'))
  return data?.parlamentares[parl] ? parl : null
}

function parseYear(q: URLSearchParams, data: Dataset | null): number | null {
  if (!q.has('ano')) return null
  const year = Number(q.get('ano'))
  return data?.meta.anos.includes(year) ? year : null
}

function parseRoute(hash: string, data: Dataset | null): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  if (path !== 'mapa') return { view: 'home' }
  const q = new URLSearchParams(query)
  return {
    view: 'mapa',
    key: query,
    params: { uf: q.get('uf') ?? '', parl: parseParl(q, data), year: parseYear(q, data) },
  }
}

const Loading = ({ children }: { children: string }) => <div className="loading">{children}</div>

interface MapRouteProps {
  data: Dataset
  mesh: Mesh | null
  params: MapParams
  theme: Theme
  onToggleTheme: () => void
}

function MapRoute({ data, mesh, params, theme, onToggleTheme }: MapRouteProps) {
  const loading = <Loading>Carregando 5.570 municípios…</Loading>
  if (!mesh) return loading
  return (
    <Suspense fallback={loading}>
      <MapPage data={data} mesh={mesh} initial={params} theme={theme} onToggleTheme={onToggleTheme} />
    </Suspense>
  )
}

export default function App() {
  const [error, setError] = useState<string | null>(null)
  const [theme, toggleTheme] = useTheme()
  const hash = useHash()
  const data = useJson<Dataset>('data/emendas.json', true, setError)
  const route = parseRoute(hash, data)
  const mesh = useJson<Mesh>('data/municipios.geojson', route.view === 'mapa', setError)

  if (error) return <Loading>{`Erro ao carregar dados: ${error}`}</Loading>
  if (!data) return <Loading>Carregando emendas…</Loading>

  return (
    <>
      {/* Kept mounted so the ranking filters survive a round trip to the map */}
      <div hidden={route.view !== 'home'}>
        <Home data={data} theme={theme} onToggleTheme={toggleTheme} />
      </div>
      {route.view === 'mapa' && (
        <MapRoute
          key={route.key}
          data={data}
          mesh={mesh}
          params={route.params}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}
    </>
  )
}
