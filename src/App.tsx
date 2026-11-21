import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  SCALE,
  UFS,
  classOf,
  formatBRL,
  formatMetric,
  metricValue,
  pagoOf,
  parlLabel,
  quantileBreaks,
  type Dataset,
  type Filter,
  type Metric,
  type Municipio,
  type Theme,
} from './data'
import { MapView, type Mesh } from './MapView'
import { DetailPanel } from './DetailPanel'
import { Avatar } from './Avatar'

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function useStoredState<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key) as T | null
    return stored && allowed.includes(stored) ? stored : fallback
  })
  useEffect(() => localStorage.setItem(key, value), [key, value])
  return [value, setValue] as const
}

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

export default function App() {
  const [data, setData] = useState<Dataset | null>(null)
  const [mesh, setMesh] = useState<Mesh | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [metric, setMetric] = useState<Metric>('per_capita')
  const [year, setYear] = useState<number | null>(null)
  const [parl, setParl] = useState<number | null>(null)
  const [uf, setUf] = useState('')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusIds, setFocusIds] = useState<string[] | null>(null)
  const [theme, setTheme] = useStoredState<Theme>(
    'tema',
    ['claro', 'escuro'],
    prefersDark ? 'escuro' : 'claro',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    Promise.all([
      fetch('data/emendas.json').then((r) => r.json() as Promise<Dataset>),
      fetch('data/municipios.geojson').then((r) => r.json() as Promise<Mesh>),
    ])
      .then(([d, m]) => {
        setData(d)
        setMesh(m)
      })
      .catch((e: unknown) => setError(String(e)))
  }, [])

  const anos = useMemo(() => data?.meta.anos ?? [], [data])
  const filter: Filter = useMemo(() => ({ year, parl }), [year, parl])

  const byId = useMemo(
    () => new Map((data?.municipios ?? []).map((m) => [m.id, m])),
    [data],
  )

  const pago = useMemo(
    () => new Map((data?.municipios ?? []).map((m) => [m.id, pagoOf(m, anos, filter)])),
    [data, anos, filter],
  )

  const valueOf = useCallback(
    (m: Municipio) => metricValue(pago.get(m.id) ?? 0, m, metric),
    [pago, metric],
  )

  // Breaks come from the whole country so colors stay comparable when filtering by state
  const breaks = useMemo(
    () => quantileBreaks((data?.municipios ?? []).map(valueOf)),
    [data, valueOf],
  )

  const classOfMun = useCallback((m: Municipio) => classOf(valueOf(m), breaks), [valueOf, breaks])

  const tooltipOf = useCallback(
    (m: Municipio) => `${m.nome} (${m.uf}): ${formatMetric(valueOf(m), metric)}`,
    [valueOf, metric],
  )

  const inScope = useMemo(
    () => (data?.municipios ?? []).filter((m) => !uf || m.uf === uf),
    [data, uf],
  )

  const totals = useMemo(() => {
    let total = 0
    let pop = 0
    let receberam = 0
    for (const m of inScope) {
      const v = pago.get(m.id) ?? 0
      total += v
      pop += m.pop ?? 0
      if (v > 0) receberam++
    }
    return { total, perCapita: pop ? total / pop : 0, receberam }
  }, [inScope, pago])

  const estadoPago = useMemo(() => {
    if (!data || !uf || parl !== null) return 0
    const v = data.estados[uf] ?? []
    return year === null ? v.reduce((a, b) => a + b, 0) : v[anos.indexOf(year)] ?? 0
  }, [data, uf, year, parl, anos])

  const topMunicipios = useMemo(
    () =>
      inScope
        .filter((m) => (pago.get(m.id) ?? 0) > 0)
        .sort((a, b) => valueOf(b) - valueOf(a))
        .slice(0, 15),
    [inScope, pago, valueOf],
  )

  const topParlamentares = useMemo(() => {
    const acc = new Map<number, number>()
    for (const m of inScope) {
      for (const [p, ano, v] of m.emendas) {
        if (year !== null && ano !== year) continue
        acc.set(p, (acc.get(p) ?? 0) + v)
      }
    }
    return [...acc].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [inScope, year])

  const rank = useMemo(() => {
    if (!data || !selectedId) return null
    const sel = byId.get(selectedId)
    if (!sel) return null
    const perCapita = (m: Municipio) => metricValue(pago.get(m.id) ?? 0, m, 'per_capita')
    const received = data.municipios.filter((m) => (pago.get(m.id) ?? 0) > 0)
    const v = perCapita(sel)
    const sameUf = received.filter((m) => m.uf === sel.uf)
    return {
      brasil: received.filter((m) => perCapita(m) > v).length + 1,
      uf: sameUf.filter((m) => perCapita(m) > v).length + 1,
      totalBrasil: received.length,
      totalUf: sameUf.length,
    }
  }, [data, byId, selectedId, pago])

  const visibleIds = useMemo(() => {
    if (!uf) return null
    return new Set(inScope.map((m) => m.id))
  }, [inScope, uf])

  const searchResults = useMemo(() => {
    const q = normalize(query.trim())
    if (q.length < 2 || !data) return { municipios: [], parlamentares: [] }
    return {
      municipios: inScope.filter((m) => normalize(m.nome).includes(q)).slice(0, 6),
      parlamentares: data.parlamentares
        .map((p, i) => [p, i] as const)
        .filter(([p]) => normalize(p.nome).includes(q))
        .slice(0, 6),
    }
  }, [data, inScope, query])

  const selectMunicipio = (id: string) => {
    setSelectedId(id)
    setFocusIds([id])
    setQuery('')
  }

  const pickParl = (p: number | null) => {
    setParl(p)
    setQuery('')
    if (p === null || !data) {
      setFocusIds(uf ? inScope.map((m) => m.id) : null)
      return
    }
    const ids = data.municipios
      .filter((m) => m.emendas.some(([ep, ano]) => ep === p && (year === null || ano === year)))
      .map((m) => m.id)
    setFocusIds(ids.length ? ids : null)
  }

  const changeUf = (next: string) => {
    setUf(next)
    setSelectedId(null)
    setFocusIds(next ? (data?.municipios ?? []).filter((m) => m.uf === next).map((m) => m.id) : null)
  }

  if (error) return <div className="loading">Erro ao carregar dados: {error}</div>
  if (!data || !mesh) return <div className="loading">Carregando 5.570 municípios…</div>

  const selected = selectedId ? byId.get(selectedId) ?? null : null
  const periodo = year === null ? `${anos[0]}–${anos[anos.length - 1]}` : String(year)
  const legendStops = [0, ...breaks]

  return (
    <div className="layout">
      <aside className="sidebar">
        <header>
          <div className="title-row">
            <h1>Emendas Pix</h1>
            <button
              className="theme-toggle"
              onClick={() => setTheme(theme === 'claro' ? 'escuro' : 'claro')}
              aria-label={theme === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'}
              title={theme === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'}
            >
              {theme === 'claro' ? '☾' : '☀'}
            </button>
          </div>
          <p className="subtitle">
            Quanto cada município recebeu em emendas Pix (transferências especiais) e de quais
            deputados e senadores
          </p>
          <p className="credit">
            Feito por{' '}
            <a
              href="https://www.linkedin.com/in/jorgejuniordeveloper/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Jorge Souza
            </a>
          </p>
        </header>

        {parl !== null && (
          <div className="parl-chip">
            <Avatar parlamentar={data.parlamentares[parl]} size={48} />
            <div className="parl-chip-text">
              <span className="muted">Mostrando só as emendas de</span>
              <strong>{data.parlamentares[parl].nome}</strong>
              <small>
                {parlLabel(data.parlamentares[parl])}
                {data.parlamentares[parl].url && (
                  <>
                    {' · '}
                    <a href={data.parlamentares[parl].url!} target="_blank" rel="noopener noreferrer">
                      perfil oficial
                    </a>
                  </>
                )}
              </small>
            </div>
            <button onClick={() => pickParl(null)} aria-label="Remover filtro de parlamentar">
              ×
            </button>
          </div>
        )}

        <section className="counters">
          <div className="counter">
            <span className="counter-value">{formatBRL(totals.total)}</span>
            <span className="counter-label">pago a municípios</span>
            <span className="counter-pct">{periodo}</span>
          </div>
          <div className="counter">
            <span className="counter-value">{formatBRL(totals.perCapita, false)}</span>
            <span className="counter-label">por habitante</span>
            <span className="counter-pct">{uf || 'Brasil'}</span>
          </div>
          <div className="counter">
            <span className="counter-value">{totals.receberam.toLocaleString('pt-BR')}</span>
            <span className="counter-label">municípios receberam</span>
            <span className="counter-pct">de {inScope.length.toLocaleString('pt-BR')}</span>
          </div>
        </section>
        {estadoPago > 0 && (
          <p className="muted">
            Além disso, o governo do estado de {uf} recebeu {formatBRL(estadoPago)} em {periodo}.
          </p>
        )}

        <section className="controls">
          <div className="search">
            <input
              type="search"
              placeholder="Buscar município ou parlamentar…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(searchResults.municipios.length > 0 || searchResults.parlamentares.length > 0) && (
              <ul className="search-results">
                {searchResults.municipios.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => selectMunicipio(m.id)}>
                      <span className="dot" style={{ background: SCALE[Math.max(0, classOfMun(m))] }} />
                      {m.nome} <small>{m.uf}</small>
                    </button>
                  </li>
                ))}
                {searchResults.parlamentares.map(([p, i]) => (
                  <li key={`p${i}`}>
                    <button onClick={() => pickParl(i)}>
                      <Avatar parlamentar={p} size={24} />
                      <span className="person">
                        {p.nome} <small>{parlLabel(p)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="row">
            <label>
              Período
              <select
                value={year ?? ''}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">
                  {anos[0]}–{anos[anos.length - 1]}
                </option>
                {anos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select value={uf} onChange={(e) => changeUf(e.target.value)}>
                <option value="">Brasil</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="segmented" role="group" aria-label="Métrica do mapa">
            <button className={metric === 'per_capita' ? 'active' : ''} onClick={() => setMetric('per_capita')}>
              Por habitante
            </button>
            <button className={metric === 'total' ? 'active' : ''} onClick={() => setMetric('total')}>
              Valor total
            </button>
          </div>
        </section>

        <section className="ranking">
          <h2>
            Municípios que mais receberam {metric === 'per_capita' ? 'por habitante' : 'no total'}
          </h2>
          {topMunicipios.length === 0 ? (
            <p className="muted">Nenhum repasse no filtro atual.</p>
          ) : (
            <ol>
              {topMunicipios.map((m, i) => (
                <li key={m.id}>
                  <button onClick={() => selectMunicipio(m.id)}>
                    <span className="rank-pos">{i + 1}</span>
                    <span className="rank-name">
                      {m.nome} <small>{m.uf}</small>
                    </span>
                    <span className="rank-value">{formatMetric(valueOf(m), metric)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        {parl === null && (
          <section className="ranking">
            <h2>Parlamentares que mais enviaram {uf ? `para ${uf}` : ''}</h2>
            <ol>
              {topParlamentares.map(([p, v], i) => (
                <li key={p}>
                  <button onClick={() => pickParl(p)} title="Ver no mapa para onde foi o dinheiro">
                    <span className="rank-pos">{i + 1}</span>
                    <Avatar parlamentar={data.parlamentares[p]} size={32} />
                    <span className="rank-name person">
                      {data.parlamentares[p].nome}
                      <small>{parlLabel(data.parlamentares[p], true)}</small>
                    </span>
                    <span className="rank-value">{formatBRL(v)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <footer className="sources">
          <h2>Fontes e método</h2>
          <ul>
            <li>
              <strong>Emendas:</strong> {data.meta.fontes.emendas}
            </li>
            <li>
              <strong>População:</strong> {data.meta.fontes.populacao}
            </li>
            <li>
              <strong>Parlamentares:</strong> {data.meta.fontes.parlamentares}
            </li>
            <li>
              <strong>Mapa:</strong> {data.meta.fontes.malha}
            </li>
          </ul>
          <p className="muted">
            “Pago” é o valor com ordem bancária já enviada ao banco; “indicado” é o que o
            parlamentar destinou no plano de ação. O ano é o da emenda. Só entram as transferências
            especiais (emendas Pix), que caem direto na conta da prefeitura sem convênio. Dados
            atualizados em {new Date(data.meta.geradoEm).toLocaleDateString('pt-BR')}.
          </p>
        </footer>
      </aside>

      <main className="map-wrap">
        <MapView
          mesh={mesh}
          byId={byId}
          classOf={classOfMun}
          tooltipOf={tooltipOf}
          visibleIds={visibleIds}
          focusIds={focusIds}
          selectedId={selectedId}
          theme={theme}
          onSelect={setSelectedId}
        />
        <div className="legend">
          <span className="legend-title">
            {metric === 'per_capita' ? 'R$ por habitante' : 'Valor pago'}, {periodo}
          </span>
          <div className="legend-scale">
            <span className="legend-item">
              <span className="swatch empty" />
              não recebeu
            </span>
            {legendStops.map((from, i) => (
              <span key={i} className="legend-item">
                <span className="swatch" style={{ background: SCALE[i] }} />
                {i === 0
                  ? `até ${formatBRL(Math.round(breaks[0] ?? 0))}`
                  : i === legendStops.length - 1
                    ? `${formatBRL(Math.round(from))}+`
                    : `${formatBRL(Math.round(from))}–${formatBRL(Math.round(legendStops[i + 1])).replace(/^R\$\s/, '')}`}
              </span>
            ))}
          </div>
        </div>
        {selected && (
          <DetailPanel
            municipio={selected}
            anos={anos}
            parlamentares={data.parlamentares}
            filter={filter}
            rank={rank}
            onPickParl={pickParl}
            onClose={() => setSelectedId(null)}
          />
        )}
      </main>
    </div>
  )
}
