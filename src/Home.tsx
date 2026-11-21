import { useMemo, useState } from 'react'
import {
  UFS,
  formatBRL,
  pagoEstado,
  pagoOf,
  pagoPorParlamentar,
  parlLabel,
  type Dataset,
  type Theme,
} from './data'
import { Avatar } from './Avatar'
import { Credit, Sources, ThemeToggle } from './Common'

const SEM_PARTIDO = 'Sem partido'
const COLLAPSED = 10

type Casa = 'Deputado' | 'Senador'
type EstadoMetric = 'total' | 'per_capita'

function mapHref(params: { uf?: string; parl?: number; year: number | null }): string {
  const q = new URLSearchParams()
  if (params.uf) q.set('uf', params.uf)
  if (params.parl !== undefined) q.set('parl', String(params.parl))
  if (params.year !== null) q.set('ano', String(params.year))
  const s = q.toString()
  return `#/mapa${s ? `?${s}` : ''}`
}

function ShowMore({ total, open, onToggle }: { total: number; open: boolean; onToggle: () => void }) {
  if (total <= COLLAPSED) return null
  return (
    <button className="show-more" onClick={onToggle}>
      {open ? 'Mostrar menos' : `Ver todos (${total})`}
    </button>
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
  const [estadoMetric, setEstadoMetric] = useState<EstadoMetric>('total')
  const [open, setOpen] = useState({ parl: false, partidos: false, estados: false })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  const porParl = useMemo(() => pagoPorParlamentar(data, year), [data, year])

  const parlamentares = useMemo(
    () =>
      [...porParl]
        .filter(([p]) => {
          const parl = data.parlamentares[p]
          return parl.casa === casa && (partido === null || (parl.partido ?? SEM_PARTIDO) === partido)
        })
        .sort((a, b) => b[1] - a[1]),
    [data, porParl, casa, partido],
  )

  const partidos = useMemo(() => {
    const acc = new Map<string, { total: number; membros: number }>()
    for (const [p, v] of porParl) {
      const sigla = data.parlamentares[p].partido ?? SEM_PARTIDO
      const cur = acc.get(sigla) ?? { total: 0, membros: 0 }
      cur.total += v
      cur.membros++
      acc.set(sigla, cur)
    }
    return [...acc].sort((a, b) => b[1].total - a[1].total)
  }, [data, porParl])

  const estados = useMemo(() => {
    const filter = { year, parl: null }
    const rows = UFS.map((uf) => {
      let municipios = 0
      let pop = 0
      for (const m of data.municipios) {
        if (m.uf !== uf) continue
        municipios += pagoOf(m, anos, filter)
        pop += m.pop ?? 0
      }
      const governo = pagoEstado(data, uf, year)
      const total = municipios + governo
      return { uf, municipios, governo, total, perCapita: pop ? total / pop : 0 }
    })
    const key = estadoMetric === 'total' ? 'total' : 'perCapita'
    return rows.filter((r) => r.total > 0).sort((a, b) => b[key] - a[key])
  }, [data, anos, year, estadoMetric])

  const total = estados.reduce((s, e) => s + e.total, 0)
  const municipiosReceberam = useMemo(
    () => data.municipios.filter((m) => pagoOf(m, anos, { year, parl: null }) > 0).length,
    [data, anos, year],
  )

  const periodo = year === null ? `entre ${anos[0]} e ${anos[anos.length - 1]}` : `em ${year}`
  const maxParl = parlamentares[0]?.[1] ?? 1
  const maxPartido = partidos[0]?.[1].total ?? 1
  const estadoValue = (e: (typeof estados)[number]) =>
    estadoMetric === 'total' ? e.total : e.perCapita
  const maxEstado = estados[0] ? estadoValue(estados[0]) : 1
  const visible = <T,>(list: T[], k: keyof typeof open) => (open[k] ? list : list.slice(0, COLLAPSED))

  return (
    <div className="home">
      <header className="home-header">
        <div className="title-row">
          <h1>Emendas Pix</h1>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        </div>
        <p className="subtitle">
          Quem mandou dinheiro por emenda Pix (transferência especial), para onde foi e quanto já
          caiu na conta das prefeituras e dos estados
        </p>
        <Credit />
      </header>

      <section className="hero">
        <div>
          <span className="hero-value">{formatBRL(total, true, 1)}</span>
          <span className="hero-label">
            pagos em emendas Pix {periodo}, para {municipiosReceberam.toLocaleString('pt-BR')}{' '}
            municípios e {estados.filter((e) => e.governo > 0).length} governos estaduais
          </span>
        </div>
        <a className="cta" href={mapHref({ year })}>
          Abrir mapa completo →
        </a>
      </section>

      <div className="period" role="group" aria-label="Período">
        <button className={year === null ? 'active' : ''} onClick={() => setYear(null)}>
          {anos[0]}–{anos[anos.length - 1]}
        </button>
        {anos.map((a) => (
          <button key={a} className={year === a ? 'active' : ''} onClick={() => setYear(a)}>
            {a}
          </button>
        ))}
      </div>

      <div className="home-grid">
        <section className="card board">
          <h2>Quem mais enviou</h2>
          <div className="segmented" role="group" aria-label="Casa">
            <button className={casa === 'Deputado' ? 'active' : ''} onClick={() => setCasa('Deputado')}>
              Deputados
            </button>
            <button className={casa === 'Senador' ? 'active' : ''} onClick={() => setCasa('Senador')}>
              Senadores
            </button>
          </div>
          {partido && (
            <p className="filter-chip">
              Só do {partido}
              <button onClick={() => setPartido(null)} aria-label="Remover filtro de partido">
                ×
              </button>
            </p>
          )}
          {parlamentares.length === 0 ? (
            <p className="muted">Nenhum repasse no filtro atual.</p>
          ) : (
            <ol>
              {visible(parlamentares, 'parl').map(([p, v], i) => {
                const parl = data.parlamentares[p]
                return (
                  <li key={p}>
                    <a className="rank-row" href={mapHref({ parl: p, year })} title="Ver no mapa para onde foi o dinheiro">
                      <span className="rank-pos">{i + 1}</span>
                      <Avatar parlamentar={parl} size={36} />
                      <span className="rank-body">
                        <span className="rank-line">
                          <span className="rank-name person">
                            {parl.nome}
                            <small>{parlLabel(parl, true)}</small>
                          </span>
                          <span className="rank-value">{formatBRL(v, true, 1)}</span>
                        </span>
                        <span className="bar-track">
                          <span className="bar-fill" style={{ width: `${(v / maxParl) * 100}%` }} />
                        </span>
                      </span>
                    </a>
                  </li>
                )
              })}
            </ol>
          )}
          <ShowMore total={parlamentares.length} open={open.parl} onToggle={() => toggle('parl')} />
        </section>

        <section className="card board">
          <h2>Por partido</h2>
          <p className="muted">Soma do que os parlamentares de cada partido enviaram. Clique para ver os nomes.</p>
          <ol>
            {visible(partidos, 'partidos').map(([sigla, { total: v, membros }], i) => (
              <li key={sigla}>
                <button
                  className={`rank-row ${partido === sigla ? 'selected' : ''}`}
                  onClick={() => setPartido(partido === sigla ? null : sigla)}
                >
                  <span className="rank-pos">{i + 1}</span>
                  <span className="rank-body">
                    <span className="rank-line">
                      <span className="rank-name person">
                        {sigla}
                        <small>
                          {membros} parlamentar{membros > 1 ? 'es' : ''}
                        </small>
                      </span>
                      <span className="rank-value">{formatBRL(v, true, 1)}</span>
                    </span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(v / maxPartido) * 100}%` }} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <ShowMore total={partidos.length} open={open.partidos} onToggle={() => toggle('partidos')} />
        </section>

        <section className="card board">
          <h2>Por estado</h2>
          <div className="segmented" role="group" aria-label="Métrica dos estados">
            <button className={estadoMetric === 'total' ? 'active' : ''} onClick={() => setEstadoMetric('total')}>
              Valor total
            </button>
            <button
              className={estadoMetric === 'per_capita' ? 'active' : ''}
              onClick={() => setEstadoMetric('per_capita')}
            >
              Por habitante
            </button>
          </div>
          <ol>
            {visible(estados, 'estados').map((e, i) => (
              <li key={e.uf}>
                <a className="rank-row" href={mapHref({ uf: e.uf, year })} title={`Ver ${e.uf} no mapa`}>
                  <span className="rank-pos">{i + 1}</span>
                  <span className="rank-body">
                    <span className="rank-line">
                      <span className="rank-name person">
                        {e.uf}
                        <small>
                          prefeituras {formatBRL(e.municipios)}
                          {e.governo > 0 && ` · governo ${formatBRL(e.governo)}`}
                        </small>
                      </span>
                      <span className="rank-value">
                        {estadoMetric === 'total' ? formatBRL(e.total, true, 1) : `${formatBRL(e.perCapita, false)}/hab.`}
                      </span>
                    </span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(estadoValue(e) / maxEstado) * 100}%` }} />
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
          <ShowMore total={estados.length} open={open.estados} onToggle={() => toggle('estados')} />
        </section>
      </div>

      <div className="home-cta">
        <a className="cta" href={mapHref({ year })}>
          Abrir mapa completo →
        </a>
        <span className="muted">Veja município por município, com busca por cidade ou parlamentar</span>
      </div>

      <Sources meta={data.meta} />
    </div>
  )
}
