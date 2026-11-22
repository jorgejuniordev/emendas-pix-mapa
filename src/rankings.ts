import {
  UFS,
  pagoEstado,
  pagoOf,
  perCapitaOf,
  type Casa,
  type Dataset,
  type Metric,
  type Parlamentar,
} from './data'

export const SEM_PARTIDO = 'Sem partido'

// [parlamentar index, valor pago]
export type ParlamentarRow = [number, number]

export interface PartidoRow {
  sigla: string
  total: number
  membros: number
}

export interface EstadoRow {
  uf: string
  municipios: number
  governo: number
  total: number
  perCapita: number
}

export const partidoOf = (p: Parlamentar): string => p.partido ?? SEM_PARTIDO

export function rankParlamentares(
  data: Dataset,
  porParl: Map<number, number>,
  casa: Casa,
  partido: string | null,
): ParlamentarRow[] {
  const matches = (p: Parlamentar) => p.casa === casa && (partido === null || partidoOf(p) === partido)
  return [...porParl].filter(([p]) => matches(data.parlamentares[p])).sort((a, b) => b[1] - a[1])
}

export function rankPartidos(data: Dataset, porParl: Map<number, number>): PartidoRow[] {
  const acc = new Map<string, PartidoRow>()
  for (const [p, v] of porParl) {
    const sigla = partidoOf(data.parlamentares[p])
    const row = acc.get(sigla) ?? { sigla, total: 0, membros: 0 }
    row.total += v
    row.membros++
    acc.set(sigla, row)
  }
  return [...acc.values()].sort((a, b) => b.total - a.total)
}

function municipiosPorUf(data: Dataset, year: number | null): Map<string, { pago: number; pop: number }> {
  const acc = new Map<string, { pago: number; pop: number }>()
  const filter = { year, parl: null }
  for (const m of data.municipios) {
    const row = acc.get(m.uf) ?? { pago: 0, pop: 0 }
    row.pago += pagoOf(m, data.meta.anos, filter)
    row.pop += m.pop ?? 0
    acc.set(m.uf, row)
  }
  return acc
}

export function estadoValue(e: EstadoRow, metric: Metric): number {
  if (metric === 'total') return e.total
  return e.perCapita
}

export function rankEstados(data: Dataset, year: number | null, metric: Metric): EstadoRow[] {
  const porUf = municipiosPorUf(data, year)
  const rows = UFS.map((uf) => {
    const { pago: municipios, pop } = porUf.get(uf) ?? { pago: 0, pop: 0 }
    const governo = pagoEstado(data, uf, year)
    const total = municipios + governo
    return { uf, municipios, governo, total, perCapita: perCapitaOf(total, pop) }
  })
  return rows.filter((r) => r.total > 0).sort((a, b) => estadoValue(b, metric) - estadoValue(a, metric))
}

export function countMunicipiosComRepasse(data: Dataset, year: number | null): number {
  const filter = { year, parl: null }
  return data.municipios.filter((m) => pagoOf(m, data.meta.anos, filter) > 0).length
}
