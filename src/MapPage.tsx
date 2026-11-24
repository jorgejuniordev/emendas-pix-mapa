import { useCallback, useMemo, useState } from 'react'
import {
  SCALE,
  UFS,
  UF_NOMES,
  classOf,
  formatBRL,
  formatMetric,
  metricValue,
  pagoOf,
  pagoPorParlamentar,
  parlLabel,
  periodLabel,
  quantileBreaks,
  type Dataset,
  type Filter,
  type Metric,
  type Municipio,
  type Parlamentar,
  type Theme,
} from './data'
import {
  computeRank,
  computeTotals,
  focusOf,
  governoPago,
  legendLabels,
  search,
  type MapParams,
  type SearchResults,
  type Totals,
} from './mapStats'
import { MapView, type Mesh } from './MapView'
import { DetailPanel } from './DetailPanel'
import { Avatar } from './Avatar'
import { Brand, CloseButton, ExternalLink, Icon, Segmented, Sources, ThemeToggle, type Option } from './Common'

const TOP_MUNICIPIOS = 15
const TOP_PARLAMENTARES = 10

const METRIC_OPTIONS: Option<Metric>[] = [
  { value: 'per_capita', label: 'Por habitante' },
  { value: 'total', label: 'Valor total' },
]

const UFS_POR_NOME = [...UFS].sort((a, b) => UF_NOMES[a].localeCompare(UF_NOMES[b], 'pt-BR'))

const metricTitle = (metric: Metric) => (metric === 'per_capita' ? 'por habitante' : 'no total')
const legendTitle = (metric: Metric) => (metric === 'per_capita' ? 'R$ por habitante' : 'Valor pago')

function ParlChip({ parlamentar, onClear }: { parlamentar: Parlamentar; onClear: () => void }) {
  return (
    <div className="parl-chip">
      <Avatar parlamentar={parlamentar} size={48} />
      <div className="parl-chip-text">
        <span className="muted">Mostrando só as emendas de</span>
        <strong>{parlamentar.nome}</strong>
        <small>
          {parlLabel(parlamentar)}
          {parlamentar.url && (
            <>
              {' · '}
              <ExternalLink href={parlamentar.url}>perfil oficial</ExternalLink>
            </>
          )}
        </small>
      </div>
      <CloseButton onClick={onClear} label="Remover filtro de parlamentar" />
    </div>
  )
}

function Counter({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="counter">
      <span className="counter-value">{value}</span>
      <span className="counter-label">{label}</span>
      <span className="counter-pct">{note}</span>
    </div>
  )
}

interface CountersProps {
  totals: Totals
  periodo: string
  uf: string
  municipiosNoEscopo: number
}

function Counters({ totals, periodo, uf, municipiosNoEscopo }: CountersProps) {
  return (
    <section className="counters">
      <Counter value={formatBRL(totals.total)} label="pago a municípios" note={periodo} />
      <Counter value={formatBRL(totals.perCapita, false)} label="por habitante" note={uf || 'Brasil'} />
      <Counter
        value={totals.receberam.toLocaleString('pt-BR')}
        label="municípios receberam"
        note={`de ${municipiosNoEscopo.toLocaleString('pt-BR')}`}
      />
    </section>
  )
}

interface SearchBoxProps {
  query: string
  results: SearchResults
  colorOf: (m: Municipio) => string
  onQueryChange: (query: string) => void
  onPickMunicipio: (id: string) => void
  onPickParl: (parl: number) => void
}

function SearchBox({ query, results, colorOf, onQueryChange, onPickMunicipio, onPickParl }: SearchBoxProps) {
  const hasResults = results.municipios.length > 0 || results.parlamentares.length > 0
  return (
    <div className="search">
      <Icon name="search" size={16} />
      <input
        type="search"
        placeholder="Buscar município ou parlamentar…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {hasResults && (
        <ul className="search-results">
          {results.municipios.map((m) => (
            <li key={m.id}>
              <button onClick={() => onPickMunicipio(m.id)}>
                <span className="dot" style={{ background: colorOf(m) }} />
                {m.nome} <small>{m.uf}</small>
              </button>
            </li>
          ))}
          {results.parlamentares.map(([p, i]) => (
            <li key={`p${i}`}>
              <button onClick={() => onPickParl(i)}>
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
  )
}

interface FiltersProps {
  anos: number[]
  year: number | null
  uf: string
  onYearChange: (year: number | null) => void
  onUfChange: (uf: string) => void
}

function Filters({ anos, year, uf, onYearChange, onUfChange }: FiltersProps) {
  return (
    <div className="row">
      <label>
        Período
        <select value={year ?? ''} onChange={(e) => onYearChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{periodLabel(anos, null)}</option>
          {anos.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label>
        Estado
        <select value={uf} onChange={(e) => onUfChange(e.target.value)}>
          <option value="">Brasil</option>
          {UFS_POR_NOME.map((u) => (
            <option key={u} value={u}>
              {UF_NOMES[u]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

interface MunicipiosRankingProps {
  municipios: Municipio[]
  metric: Metric
  valueOf: (m: Municipio) => number
  onSelect: (id: string) => void
}

function MunicipiosRanking({ municipios, metric, valueOf, onSelect }: MunicipiosRankingProps) {
  return (
    <section className="ranking">
      <h2>Municípios que mais receberam {metricTitle(metric)}</h2>
      {municipios.length === 0 && <p className="muted">Nenhum repasse no filtro atual.</p>}
      {municipios.length > 0 && (
        <ol>
          {municipios.map((m, i) => (
            <li key={m.id}>
              <button onClick={() => onSelect(m.id)}>
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
  )
}

interface ParlamentaresRankingProps {
  parlamentares: Parlamentar[]
  rows: [number, number][]
  uf: string
  onPick: (parl: number) => void
}

function ParlamentaresRanking({ parlamentares, rows, uf, onPick }: ParlamentaresRankingProps) {
  return (
    <section className="ranking">
      <h2>Parlamentares que mais enviaram {uf ? `para ${uf}` : ''}</h2>
      <ol>
        {rows.map(([p, v], i) => (
          <li key={p}>
            <button onClick={() => onPick(p)} title="Ver no mapa para onde foi o dinheiro">
              <span className="rank-pos">{i + 1}</span>
              <Avatar parlamentar={parlamentares[p]} size={32} />
              <span className="rank-name person">
                {parlamentares[p].nome}
                <small>{parlLabel(parlamentares[p], true)}</small>
              </span>
              <span className="rank-value">{formatBRL(v)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Legend({ metric, periodo, breaks }: { metric: Metric; periodo: string; breaks: number[] }) {
  return (
    <div className="legend">
      <span className="legend-title">
        {legendTitle(metric)}, {periodo}
      </span>
      <div className="legend-scale">
        <span className="legend-item">
          <span className="swatch empty" />
          não recebeu
        </span>
        {legendLabels(breaks).map((label, i) => (
          <span key={i} className="legend-item">
            <span className="swatch" style={{ background: SCALE[i] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

interface Props {
  data: Dataset
  mesh: Mesh
  initial: MapParams
  theme: Theme
  onToggleTheme: () => void
}

export function MapPage({ data, mesh, initial, theme, onToggleTheme }: Props) {
  const [metric, setMetric] = useState<Metric>('per_capita')
  const [year, setYear] = useState<number | null>(initial.year)
  const [parl, setParl] = useState<number | null>(initial.parl)
  const [uf, setUf] = useState(initial.uf)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusIds, setFocusIds] = useState<string[] | null>(() => focusOf(data, initial))

  const anos = data.meta.anos
  const filter: Filter = useMemo(() => ({ year, parl }), [year, parl])

  const byId = useMemo(() => new Map(data.municipios.map((m) => [m.id, m])), [data])

  const pago = useMemo(
    () => new Map(data.municipios.map((m) => [m.id, pagoOf(m, anos, filter)])),
    [data, anos, filter],
  )

  const valueOf = useCallback(
    (m: Municipio) => metricValue(pago.get(m.id) ?? 0, m, metric),
    [pago, metric],
  )

  // Breaks come from the whole country so colors stay comparable when filtering by state
  const breaks = useMemo(() => quantileBreaks(data.municipios.map(valueOf)), [data, valueOf])

  const classOfMun = useCallback((m: Municipio) => classOf(valueOf(m), breaks), [valueOf, breaks])
  const colorOf = useCallback((m: Municipio) => SCALE[Math.max(0, classOfMun(m))], [classOfMun])

  const tooltipOf = useCallback(
    (m: Municipio) => `${m.nome} (${m.uf}): ${formatMetric(valueOf(m), metric)}`,
    [valueOf, metric],
  )

  const inScope = useMemo(() => data.municipios.filter((m) => !uf || m.uf === uf), [data, uf])
  const totals = useMemo(() => computeTotals(inScope, pago), [inScope, pago])
  const estadoPago = useMemo(() => governoPago(data, { uf, parl, year }), [data, uf, year, parl])

  const topMunicipios = useMemo(
    () =>
      inScope
        .filter((m) => (pago.get(m.id) ?? 0) > 0)
        .sort((a, b) => valueOf(b) - valueOf(a))
        .slice(0, TOP_MUNICIPIOS),
    [inScope, pago, valueOf],
  )

  const topParlamentares = useMemo(
    () => [...pagoPorParlamentar(data, year, uf)].sort((a, b) => b[1] - a[1]).slice(0, TOP_PARLAMENTARES),
    [data, year, uf],
  )

  const selected = selectedId ? byId.get(selectedId) : undefined
  const rank = useMemo(() => computeRank(data, selected, pago), [data, selected, pago])
  const visibleIds = useMemo(() => (uf ? new Set(inScope.map((m) => m.id)) : null), [inScope, uf])
  const searchResults = useMemo(() => search(data, inScope, query), [data, inScope, query])

  const selectMunicipio = (id: string) => {
    setSelectedId(id)
    setFocusIds([id])
    setQuery('')
  }

  const pickParl = (p: number | null) => {
    setParl(p)
    setQuery('')
    setFocusIds(focusOf(data, { uf, parl: p, year }))
  }

  const changeUf = (next: string) => {
    setUf(next)
    setSelectedId(null)
    setFocusIds(focusOf(data, { uf: next, parl: null, year }))
  }

  const periodo = periodLabel(anos, year)

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="sidebar-head">
          <div className="sidebar-top">
            <Brand />
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
          <a className="back-link" href="#/">
            <Icon name="arrow-left" size={14} />
            Voltar aos rankings
          </a>
          <h1>Quanto cada município recebeu</h1>
          <p className="subtitle">
            Emendas Pix (transferências especiais) pagas a cada prefeitura e os deputados e senadores
            que enviaram o dinheiro
          </p>
        </header>

        {parl !== null && <ParlChip parlamentar={data.parlamentares[parl]} onClear={() => pickParl(null)} />}

        <Counters totals={totals} periodo={periodo} uf={uf} municipiosNoEscopo={inScope.length} />
        {estadoPago > 0 && (
          <p className="muted">
            Além disso, o governo do estado de {uf} recebeu {formatBRL(estadoPago)} em {periodo}.
          </p>
        )}

        <section className="controls">
          <SearchBox
            query={query}
            results={searchResults}
            colorOf={colorOf}
            onQueryChange={setQuery}
            onPickMunicipio={selectMunicipio}
            onPickParl={pickParl}
          />
          <Filters anos={anos} year={year} uf={uf} onYearChange={setYear} onUfChange={changeUf} />
          <Segmented label="Métrica do mapa" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />
        </section>

        <MunicipiosRanking municipios={topMunicipios} metric={metric} valueOf={valueOf} onSelect={selectMunicipio} />

        {parl === null && (
          <ParlamentaresRanking
            parlamentares={data.parlamentares}
            rows={topParlamentares}
            uf={uf}
            onPick={pickParl}
          />
        )}

        <Sources meta={data.meta} compact />
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
        <Legend metric={metric} periodo={periodo} breaks={breaks} />
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
