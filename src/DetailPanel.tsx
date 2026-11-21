import { useMemo } from 'react'
import { SCALE, formatBRL, parlLabel, type Filter, type Municipio, type Parlamentar } from './data'
import { Avatar } from './Avatar'

interface Props {
  municipio: Municipio
  anos: number[]
  parlamentares: Parlamentar[]
  filter: Filter
  rank: { brasil: number; uf: number; totalBrasil: number; totalUf: number } | null
  onPickParl: (parl: number) => void
  onClose: () => void
}

export function DetailPanel({ municipio, anos, parlamentares, filter, rank, onPickParl, onClose }: Props) {
  const { year, parl } = filter

  const porAno = useMemo(
    () =>
      anos.map((ano) =>
        municipio.emendas
          .filter(([p, a]) => a === ano && (parl === null || p === parl))
          .reduce((s, e) => s + e[2], 0),
      ),
    [municipio, anos, parl],
  )
  const maxAno = Math.max(1, ...porAno)

  const porParlamentar = useMemo(() => {
    const acc = new Map<number, { pago: number; indicado: number }>()
    for (const [p, ano, pago, indicado] of municipio.emendas) {
      if (year !== null && ano !== year) continue
      const cur = acc.get(p) ?? { pago: 0, indicado: 0 }
      cur.pago += pago
      cur.indicado += indicado
      acc.set(p, cur)
    }
    return [...acc].sort((a, b) => b[1].pago - a[1].pago || b[1].indicado - a[1].indicado)
  }, [municipio, year])

  const pago = year === null ? porAno.reduce((a, b) => a + b, 0) : porAno[anos.indexOf(year)]
  const perCapita = municipio.pop ? pago / municipio.pop : 0
  const periodo = year === null ? `${anos[0]}–${anos[anos.length - 1]}` : String(year)

  return (
    <div className="detail">
      <button className="detail-close" onClick={onClose} aria-label="Fechar">
        ×
      </button>
      <h2>
        {municipio.nome} <small>{municipio.uf}</small>
      </h2>
      <p className="muted">
        {municipio.pop ? `${municipio.pop.toLocaleString('pt-BR')} habitantes` : 'População não informada'}
      </p>

      <div className="detail-stats">
        <div>
          <span className="stat-value">{formatBRL(pago)}</span>
          <span className="stat-label">
            pago em {periodo}
            {parl !== null && ` por ${parlamentares[parl].nome}`}
          </span>
        </div>
        <div>
          <span className="stat-value">{formatBRL(perCapita, false)}</span>
          <span className="stat-label">por habitante</span>
        </div>
      </div>
      {rank && pago > 0 && (
        <p className="muted">
          {rank.brasil}º maior valor por habitante do Brasil (de {rank.totalBrasil.toLocaleString('pt-BR')}) e{' '}
          {rank.uf}º em {municipio.uf} (de {rank.totalUf})
        </p>
      )}

      <div className="years">
        {anos.map((ano, i) => (
          <div key={ano} className={`year ${year === ano ? 'active' : ''}`} title={formatBRL(porAno[i], false)}>
            <div className="year-bar-track">
              <div
                className="year-bar"
                style={{ height: `${(porAno[i] / maxAno) * 100}%`, background: SCALE[3] }}
              />
            </div>
            <span>{String(ano).slice(2)}</span>
          </div>
        ))}
      </div>

      <h3>Quem mandou o dinheiro ({periodo})</h3>
      {porParlamentar.length === 0 ? (
        <p className="muted">Nenhuma emenda Pix para este município no período.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Parlamentar</th>
              <th className="num">Pago</th>
              <th className="num">Indicado</th>
            </tr>
          </thead>
          <tbody>
            {porParlamentar.map(([p, v]) => (
              <tr key={p} className={p === parl ? 'highlight' : ''}>
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
      )}
    </div>
  )
}
