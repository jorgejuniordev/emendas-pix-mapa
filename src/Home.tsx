import { useMemo, useState, type ReactNode } from 'react'
import {
  UF_NOMES,
  formatBRL,
  pagoPorParlamentar,
  parlLabel,
  periodLabel,
  sum,
  type Casa,
  type Dataset,
  type Metric,
  type Theme,
} from './data'
import {
  countMunicipiosComRepasse,
  estadoValue,
  rankEstados,
  rankParlamentares,
  rankPartidos,
  type EstadoRow,
  type ParlamentarRow,
  type PartidoRow,
} from './rankings'
import { Avatar } from './Avatar'
import { Bar, CloseButton, Icon, Segmented, Sources, TopBar, type Option } from './Common'

const COLLAPSED = 10

const CASA_OPTIONS: Option<Casa>[] = [
  { value: 'Deputado', label: 'Deputados' },
  { value: 'Senador', label: 'Senadores' },
]

const ESTADO_METRIC_OPTIONS: Option<Metric>[] = [
  { value: 'total', label: 'Valor total' },
  { value: 'per_capita', label: 'Por habitante' },
]

function mapHref(params: { uf?: string; parl?: number; year: number | null }): string {
  const q = new URLSearchParams()
  if (params.uf) q.set('uf', params.uf)
  if (params.parl !== undefined) q.set('parl', String(params.parl))
  if (params.year !== null) q.set('ano', String(params.year))
  const s = q.toString()
  return `#/mapa${s ? `?${s}` : ''}`
}

function periodoPorExtenso(anos: number[], year: number | null): string {
  if (year !== null) return `em ${year}`
  return `entre ${anos[0]} e ${anos[anos.length - 1]}`
}

function formatEstadoValue(e: EstadoRow, metric: Metric): string {
  if (metric === 'total') return formatBRL(e.total, true, 1)
  return `${formatBRL(e.perCapita, false)}/hab.`
}

const pluralParlamentar = (n: number) => `${n} parlamentar${n > 1 ? 'es' : ''}`

function useCollapsible<T>(items: T[]) {
  const [open, setOpen] = useState(false)
  const showMore =
    items.length > COLLAPSED ? (
      <button className="show-more" onClick={() => setOpen((o) => !o)}>
        {open ? 'Mostrar menos' : `Ver todos (${items.length})`}
      </button>
    ) : null
  return { visible: open ? items : items.slice(0, COLLAPSED), showMore }
}

interface RankContentProps {
  pos: number
  avatar?: ReactNode
  name: ReactNode
  detail: ReactNode
  value: string
  ratio: number
}

function RankContent({ pos, avatar, name, detail, value, ratio }: RankContentProps) {
  return (
    <>
      <span className="rank-pos">{pos}</span>
      {avatar}
      <span className="rank-body">
        <span className="rank-line">
          <span className="rank-name person">
            <span>{name}</span>
            <small>{detail}</small>
          </span>
          <span className="rank-value">{value}</span>
        </span>
        <Bar ratio={ratio} />
      </span>
    </>
  )
}

function MapCta({ year, label = 'Explorar o mapa' }: { year: number | null; label?: string }) {
  return (
    <a className="cta" href={mapHref({ year })}>
      <Icon name="map" />
      {label}
      <Icon name="arrow-right" size={16} />
    </a>
  )
}

function CardHead({ index, title, description }: { index: number; title: string; description: string }) {
  return (
    <header className="card-head">
      <span className="card-index">{String(index).padStart(2, '0')}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  )
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

interface HeroProps {
  total: number
  periodo: string
  municipios: number
  governos: number
  parlamentares: number
  year: number | null
}

function Hero({ total, periodo, municipios, governos, parlamentares, year }: HeroProps) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <span className="eyebrow">Orçamento da União · Transferências especiais</span>
        <h1>Para onde vai o dinheiro das emendas Pix</h1>
        <p className="lede">
          Quem mandou dinheiro por emenda Pix, para onde foi e quanto já caiu na conta das prefeituras e
          dos governos estaduais, sem convênio.
        </p>
        <div className="hero-actions">
          <MapCta year={year} />
          <span className="muted">Município por município, com busca por cidade ou parlamentar</span>
        </div>
      </div>
      <aside className="hero-figure" aria-label="Resumo do período">
        <span className="hero-figure-label">Total pago {periodo}</span>
        <span className="hero-value">{formatBRL(total, true, 1)}</span>
        <dl className="hero-stats">
          <HeroStat value={municipios.toLocaleString('pt-BR')} label="municípios" />
          <HeroStat value={String(governos)} label="governos estaduais" />
          <HeroStat value={parlamentares.toLocaleString('pt-BR')} label="parlamentares" />
        </dl>
      </aside>
    </section>
  )
}

interface ParlamentaresBoardProps {
  data: Dataset
  rows: ParlamentarRow[]
  year: number | null
  casa: Casa
  partido: string | null
  onCasaChange: (casa: Casa) => void
  onClearPartido: () => void
}

function ParlamentaresBoard({ data, rows, year, casa, partido, onCasaChange, onClearPartido }: ParlamentaresBoardProps) {
  const { visible, showMore } = useCollapsible(rows)
  const max = rows[0]?.[1] ?? 1

  return (
    <section className="card board">
      <CardHead index={1} title="Quem mais enviou" description="Parlamentares pelo valor já pago. Clique para ver no mapa." />
      <Segmented label="Casa" options={CASA_OPTIONS} value={casa} onChange={onCasaChange} />
      {partido && (
        <p className="filter-chip">
          <span>
            Filtrando por <strong>{partido}</strong>
          </span>
          <CloseButton onClick={onClearPartido} label="Remover filtro de partido" />
        </p>
      )}
      {rows.length === 0 && <p className="muted">Nenhum repasse no filtro atual.</p>}
      {rows.length > 0 && (
        <ol>
          {visible.map(([p, v], i) => (
            <li key={p}>
              <a className="rank-row" href={mapHref({ parl: p, year })} title="Ver no mapa para onde foi o dinheiro">
                <RankContent
                  pos={i + 1}
                  avatar={<Avatar parlamentar={data.parlamentares[p]} size={36} />}
                  name={data.parlamentares[p].nome}
                  detail={parlLabel(data.parlamentares[p], true)}
                  value={formatBRL(v, true, 1)}
                  ratio={v / max}
                />
              </a>
            </li>
          ))}
        </ol>
      )}
      {showMore}
    </section>
  )
}

interface PartidosBoardProps {
  rows: PartidoRow[]
  selected: string | null
  onSelect: (sigla: string | null) => void
}

function PartidosBoard({ rows, selected, onSelect }: PartidosBoardProps) {
  const { visible, showMore } = useCollapsible(rows)
  const max = rows[0]?.total ?? 1
  const toggle = (sigla: string) => onSelect(selected === sigla ? null : sigla)

  return (
    <section className="card board">
      <CardHead
        index={2}
        title="Por partido"
        description="Soma do que os parlamentares de cada partido enviaram. Clique para filtrar os nomes."
      />
      <ol>
        {visible.map((row, i) => (
          <li key={row.sigla}>
            <button className={`rank-row ${selected === row.sigla ? 'selected' : ''}`} onClick={() => toggle(row.sigla)}>
              <RankContent
                pos={i + 1}
                name={row.sigla}
                detail={pluralParlamentar(row.membros)}
                value={formatBRL(row.total, true, 1)}
                ratio={row.total / max}
              />
            </button>
          </li>
        ))}
      </ol>
      {showMore}
    </section>
  )
}

interface EstadosBoardProps {
  rows: EstadoRow[]
  year: number | null
  metric: Metric
  onMetricChange: (metric: Metric) => void
}

function EstadosBoard({ rows, year, metric, onMetricChange }: EstadosBoardProps) {
  const { visible, showMore } = useCollapsible(rows)
  const max = rows[0] ? estadoValue(rows[0], metric) : 1

  return (
    <section className="card board">
      <CardHead index={3} title="Por estado" description="Prefeituras somadas ao governo estadual de cada UF." />
      <Segmented
        label="Métrica dos estados"
        options={ESTADO_METRIC_OPTIONS}
        value={metric}
        onChange={onMetricChange}
      />
      <ol>
        {visible.map((e, i) => (
          <li key={e.uf}>
            <a className="rank-row" href={mapHref({ uf: e.uf, year })} title={`Ver ${e.uf} no mapa`}>
              <RankContent
                pos={i + 1}
                name={
                  <>
                    {UF_NOMES[e.uf]} <span className="uf-tag">{e.uf}</span>
                  </>
                }
                detail={
                  <>
                    prefeituras {formatBRL(e.municipios)}
                    {e.governo > 0 && ` · governo ${formatBRL(e.governo)}`}
                  </>
                }
                value={formatEstadoValue(e, metric)}
                ratio={estadoValue(e, metric) / max}
              />
            </a>
          </li>
        ))}
      </ol>
      {showMore}
    </section>
  )
}

interface Props {
  data: Dataset
  theme: Theme
  onToggleTheme: () => void
}

export function Home({ data, theme, onToggleTheme }: Props) {
  const anos = data.meta.anos
  const [year, setYear] = useState<number | null>(null)
  const [casa, setCasa] = useState<Casa>('Deputado')
  const [partido, setPartido] = useState<string | null>(null)
  const [estadoMetric, setEstadoMetric] = useState<Metric>('total')

  const porParl = useMemo(() => pagoPorParlamentar(data, year), [data, year])
  const parlamentares = useMemo(
    () => rankParlamentares(data, porParl, casa, partido),
    [data, porParl, casa, partido],
  )
  const partidos = useMemo(() => rankPartidos(data, porParl), [data, porParl])
  const estados = useMemo(() => rankEstados(data, year, estadoMetric), [data, year, estadoMetric])
  const municipiosReceberam = useMemo(() => countMunicipiosComRepasse(data, year), [data, year])

  const periodOptions: Option<number | null>[] = [
    { value: null, label: periodLabel(anos, null) },
    ...anos.map((a) => ({ value: a, label: String(a) })),
  ]

  return (
    <div className="page">
      <TopBar page="home" theme={theme} onToggleTheme={onToggleTheme} />
      <main className="home">
        <Hero
          total={sum(estados.map((e) => e.total))}
          periodo={periodoPorExtenso(anos, year)}
          municipios={municipiosReceberam}
          governos={estados.filter((e) => e.governo > 0).length}
          parlamentares={porParl.size}
          year={year}
        />

        <div className="toolbar">
          <span className="toolbar-label">Período</span>
          <Segmented className="period" label="Período" options={periodOptions} value={year} onChange={setYear} />
        </div>

        <div className="home-grid">
          <ParlamentaresBoard
            data={data}
            rows={parlamentares}
            year={year}
            casa={casa}
            partido={partido}
            onCasaChange={setCasa}
            onClearPartido={() => setPartido(null)}
          />
          <PartidosBoard rows={partidos} selected={partido} onSelect={setPartido} />
          <EstadosBoard rows={estados} year={year} metric={estadoMetric} onMetricChange={setEstadoMetric} />
        </div>

        <section className="cta-band">
          <div>
            <h2>Veja onde o dinheiro caiu</h2>
            <p>
              O mapa mostra os 5.570 municípios coloridos pelo valor recebido por habitante, com o
              detalhe de quem enviou cada real.
            </p>
          </div>
          <MapCta year={year} label="Abrir mapa completo" />
        </section>
      </main>
      <Sources meta={data.meta} />
    </div>
  )
}
