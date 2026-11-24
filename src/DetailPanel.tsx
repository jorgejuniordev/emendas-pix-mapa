import { useMemo } from 'react'
import {
  UF_NOMES,
  formatBRL,
  inYear,
  parlLabel,
  perCapitaOf,
  periodLabel,
  sum,
  type Filter,
  type Municipio,
  type Parlamentar,
} from './data'
import type { Rank } from './mapStats'
import { Avatar } from './Avatar'
import { CloseButton } from './Common'

type Autoria = { pago: number; indicado: number }

function pagoPorAno(municipio: Municipio, anos: number[], parl: number | null): number[] {
  return anos.map((ano) =>
    sum(municipio.emendas.filter(([p, a]) => a === ano && (parl === null || p === parl)).map((e) => e[2])),
  )
}

function autoriasNoPeriodo(municipio: Municipio, year: number | null): [number, Autoria][] {
  const acc = new Map<number, Autoria>()
  for (const [p, ano, pago, indicado] of municipio.emendas) {
    if (!inYear(ano, year)) continue
    const cur = acc.get(p) ?? { pago: 0, indicado: 0 }
    cur.pago += pago
    cur.indicado += indicado
    acc.set(p, cur)
  }
  return [...acc].sort((a, b) => b[1].pago - a[1].pago || b[1].indicado - a[1].indicado)
}

function pagoNoPeriodo(porAno: number[], anos: number[], year: number | null): number {
  if (year === null) return sum(porAno)
  return porAno[anos.indexOf(year)]
}

const populacaoLabel = (pop: number | null) =>
  pop ? `${pop.toLocaleString('pt-BR')} hab.` : 'população não informada'

function YearBars({ anos, porAno, year }: { anos: number[]; porAno: number[]; year: number | null }) {
  const max = Math.max(1, ...porAno)
  return (
    <div className="years">
      {anos.map((ano, i) => (
        <div key={ano} className={`year ${year === ano ? 'active' : ''}`} title={formatBRL(porAno[i], false)}>
          <div className="year-bar-track">
            <div className="year-bar" style={{ height: `${(porAno[i] / max) * 100}%` }} />
          </div>
          <span>{String(ano).slice(2)}</span>
        </div>
      ))}
    </div>
  )
}

interface AutoriasTableProps {
  autorias: [number, Autoria][]
  parlamentares: Parlamentar[]
  highlight: number | null
  onPickParl: (parl: number) => void
}

function AutoriasTable({ autorias, parlamentares, highlight, onPickParl }: AutoriasTableProps) {
  if (autorias.length === 0) return <p className="muted">Nenhuma emenda Pix para este município no período.</p>
  return (
    <table>
      <thead>
        <tr>
          <th>Parlamentar</th>
          <th className="num">Pago</th>
          <th className="num">Indicado</th>
        </tr>
      </thead>
      <tbody>
        {autorias.map(([p, v]) => (
          <tr key={p} className={p === highlight ? 'highlight' : ''}>
            <td>
              <div className="person-cell">
                <Avatar parlamentar={parlamentares[p]} size={26} />
                <span className="person">
                  <button
                    className="link-button"
                    onClick={() => onPickParl(p)}
                    title="Ver todos os municípios deste parlamentar"
                  >
                    {parlamentares[p].nome}
                  </button>
                  <small>{parlLabel(parlamentares[p], true)}</small>
                </span>
              </div>
            </td>
            <td className="num">{formatBRL(v.pago)}</td>
            <td className="num">{formatBRL(v.indicado)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface Props {
  municipio: Municipio
  anos: number[]
  parlamentares: Parlamentar[]
  filter: Filter
  rank: Rank | null
  onPickParl: (parl: number) => void
  onClose: () => void
}

export function DetailPanel({ municipio, anos, parlamentares, filter, rank, onPickParl, onClose }: Props) {
  const { year, parl } = filter

  const porAno = useMemo(() => pagoPorAno(municipio, anos, parl), [municipio, anos, parl])
  const autorias = useMemo(() => autoriasNoPeriodo(municipio, year), [municipio, year])

  const pago = pagoNoPeriodo(porAno, anos, year)
  const periodo = periodLabel(anos, year)

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <span className="eyebrow">
            {UF_NOMES[municipio.uf]} · {populacaoLabel(municipio.pop)}
          </span>
          <h2>{municipio.nome}</h2>
        </div>
        <CloseButton onClick={onClose} label="Fechar" className="icon-button detail-close" />
      </header>

      <div className="detail-stats">
        <div>
          <span className="stat-value">{formatBRL(pago)}</span>
          <span className="stat-label">
            pago em {periodo}
            {parl !== null && ` por ${parlamentares[parl].nome}`}
          </span>
        </div>
        <div>
          <span className="stat-value">{formatBRL(perCapitaOf(pago, municipio.pop), false)}</span>
          <span className="stat-label">por habitante</span>
        </div>
      </div>
      {rank && pago > 0 && (
        <p className="muted">
          {rank.brasil}º maior valor por habitante do Brasil (de {rank.totalBrasil.toLocaleString('pt-BR')}) e{' '}
          {rank.uf}º em {municipio.uf} (de {rank.totalUf})
        </p>
      )}

      <YearBars anos={anos} porAno={porAno} year={year} />

      <h3>Quem mandou o dinheiro ({periodo})</h3>
      <AutoriasTable autorias={autorias} parlamentares={parlamentares} highlight={parl} onPickParl={onPickParl} />
    </div>
  )
}
