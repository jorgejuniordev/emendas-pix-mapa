import {
  formatBRL,
  inYear,
  metricValue,
  pagoEstado,
  perCapitaOf,
  type Dataset,
  type Municipio,
  type Parlamentar,
} from './data'

export interface MapParams {
  uf: string
  parl: number | null
  year: number | null
}

export interface Totals {
  total: number
  perCapita: number
  receberam: number
}

export interface Rank {
  brasil: number
  uf: number
  totalBrasil: number
  totalUf: number
}

export interface SearchResults {
  municipios: Municipio[]
  parlamentares: (readonly [Parlamentar, number])[]
}

const SEARCH_LIMIT = 6
const MIN_QUERY = 2

export const normalizeSearch = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function isInFocus(m: Municipio, { uf, parl, year }: MapParams): boolean {
  if (parl !== null) return m.emendas.some(([ep, ano]) => ep === parl && inYear(ano, year))
  return Boolean(uf) && m.uf === uf
}

export function focusOf(data: Dataset, params: MapParams): string[] | null {
  const ids = data.municipios.filter((m) => isInFocus(m, params)).map((m) => m.id)
  return ids.length ? ids : null
}

export function computeTotals(municipios: Municipio[], pago: Map<string, number>): Totals {
  let total = 0
  let pop = 0
  let receberam = 0
  for (const m of municipios) {
    const v = pago.get(m.id) ?? 0
    total += v
    pop += m.pop ?? 0
    if (v > 0) receberam++
  }
  return { total, perCapita: perCapitaOf(total, pop), receberam }
}

export function governoPago(data: Dataset, { uf, parl, year }: MapParams): number {
  if (!uf || parl !== null) return 0
  return pagoEstado(data, uf, year)
}

export function computeRank(data: Dataset, selected: Municipio | undefined, pago: Map<string, number>): Rank | null {
  if (!selected) return null
  const pagoDe = (m: Municipio) => pago.get(m.id) ?? 0
  const perCapita = (m: Municipio) => metricValue(pagoDe(m), m, 'per_capita')
  const received = data.municipios.filter((m) => pagoDe(m) > 0)
  const sameUf = received.filter((m) => m.uf === selected.uf)
  const v = perCapita(selected)
  const positionIn = (list: Municipio[]) => list.filter((m) => perCapita(m) > v).length + 1
  return {
    brasil: positionIn(received),
    uf: positionIn(sameUf),
    totalBrasil: received.length,
    totalUf: sameUf.length,
  }
}

export function search(data: Dataset, municipios: Municipio[], query: string): SearchResults {
  const q = normalizeSearch(query.trim())
  if (q.length < MIN_QUERY) return { municipios: [], parlamentares: [] }
  const matches = (nome: string) => normalizeSearch(nome).includes(q)
  return {
    municipios: municipios.filter((m) => matches(m.nome)).slice(0, SEARCH_LIMIT),
    parlamentares: data.parlamentares
      .map((p, i) => [p, i] as const)
      .filter(([p]) => matches(p.nome))
      .slice(0, SEARCH_LIMIT),
  }
}

const formatStop = (v: number) => formatBRL(Math.round(v))

function legendLabel(stops: number[], i: number): string {
  if (i === 0) return `até ${formatStop(stops[1] ?? 0)}`
  if (i === stops.length - 1) return `${formatStop(stops[i])}+`
  return `${formatStop(stops[i])}–${formatStop(stops[i + 1]).replace(/^R\$\s/, '')}`
}

export function legendLabels(breaks: number[]): string[] {
  const stops = [0, ...breaks]
  return stops.map((_, i) => legendLabel(stops, i))
}
