// [parlamentar index, ano da emenda, valor pago, valor indicado]
export type Emenda = [number, number, number, number]

// [parlamentar index, ano da emenda, valor pago] sent to the state government
export type EmendaEstado = [number, number, number]

export type Casa = 'Deputado' | 'Senador'
export type Metric = 'per_capita' | 'total'
export type Theme = 'claro' | 'escuro'

export interface Municipio {
  id: string
  nome: string
  uf: string
  pop: number | null
  pago: number[]
  indicado: number[]
  emendas: Emenda[]
}

export interface Parlamentar {
  nome: string
  partido: string | null
  uf: string | null
  casa: Casa | null
  foto: string | null
  url: string | null
}

export interface Dataset {
  meta: {
    geradoEm: string
    anos: number[]
    populacaoAno: string
    totalPago: number
    fontes: { emendas: string; populacao: string; parlamentares: string; malha: string }
  }
  parlamentares: Parlamentar[]
  municipios: Municipio[]
  estados: Record<string, number[]>
  emendasEstado: Record<string, EmendaEstado[]>
}

export interface Filter {
  year: number | null
  parl: number | null
}

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
  'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

// Viridis: perceptually uniform and readable under the common types of color blindness
export const SCALE = ['#fde725', '#7ad151', '#22a884', '#2a788e', '#414487', '#440154']

export const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0)

export const inYear = (ano: number, year: number | null): boolean => year === null || ano === year

export const perCapitaOf = (total: number, pop: number | null | undefined): number =>
  pop ? total / pop : 0

export function periodLabel(anos: number[], year: number | null): string {
  if (year !== null) return String(year)
  return `${anos[0]}–${anos[anos.length - 1]}`
}

function casaLabel(casa: Casa | null, short: boolean): string {
  if (!casa) return ''
  if (!short) return casa
  return casa === 'Senador' ? 'Sen.' : 'Dep.'
}

export function parlLabel(p: Parlamentar, short = false): string {
  const sigla = [p.partido, p.uf].filter(Boolean).join('-')
  return [casaLabel(p.casa, short), sigla].filter(Boolean).join(' · ')
}

export function pagoPorParlamentar(data: Dataset, year: number | null, uf = ''): Map<number, number> {
  const acc = new Map<number, number>()
  const add = ([p, ano, v]: EmendaEstado | Emenda) => {
    if (v > 0 && inYear(ano, year)) acc.set(p, (acc.get(p) ?? 0) + v)
  }
  const inUf = (estado: string) => !uf || estado === uf

  for (const m of data.municipios.filter((m) => inUf(m.uf))) m.emendas.forEach(add)
  for (const [estado, ems] of Object.entries(data.emendasEstado)) {
    if (inUf(estado)) ems.forEach(add)
  }
  return acc
}

function pagoNoAno(valores: number[], anos: number[], year: number | null): number {
  if (year === null) return sum(valores)
  return valores[anos.indexOf(year)] ?? 0
}

export function pagoEstado(data: Dataset, uf: string, year: number | null): number {
  return pagoNoAno(data.estados[uf] ?? [], data.meta.anos, year)
}

function pagoDoParlamentar(m: Municipio, parl: number, year: number | null): number {
  return sum(m.emendas.filter(([p, ano]) => p === parl && inYear(ano, year)).map(([, , pago]) => pago))
}

export function pagoOf(m: Municipio, anos: number[], { year, parl }: Filter): number {
  if (parl !== null) return pagoDoParlamentar(m, parl, year)
  return pagoNoAno(m.pago, anos, year)
}

export function metricValue(pago: number, m: Municipio, metric: Metric): number {
  if (metric === 'total') return pago
  return perCapitaOf(pago, m.pop)
}

export function quantileBreaks(values: number[], classes = SCALE.length): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (!sorted.length) return []
  const breaks: number[] = []
  for (let i = 1; i < classes; i++) {
    const v = sorted[Math.min(sorted.length - 1, Math.floor((i / classes) * sorted.length))]
    if (!breaks.length || v > breaks[breaks.length - 1]) breaks.push(v)
  }
  return breaks
}

export function classOf(v: number, breaks: number[]): number {
  if (v <= 0) return -1
  let i = 0
  while (i < breaks.length && v >= breaks[i]) i++
  return i
}

const COMPACT_UNITS: [number, string][] = [
  [1e9, 'bi'],
  [1e6, 'mi'],
  [1e3, 'mil'],
]

function formatCurrency(v: number): string {
  const digits = Number.isInteger(v) || v >= 100 ? 0 : 2
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatCompact(v: number, digits?: number): string {
  const [div, label] = COMPACT_UNITS.find(([d]) => Math.abs(v) >= d)!
  const n = v / div
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: digits ?? (n < 10 ? 1 : 0) })} ${label}`
}

export function formatBRL(v: number, compact = true, digits?: number): string {
  if (!compact || Math.abs(v) < 1000) return formatCurrency(v)
  return formatCompact(v, digits)
}

export function formatMetric(v: number, metric: Metric): string {
  if (metric === 'per_capita') return `${formatBRL(v, false)}/hab.`
  return formatBRL(v)
}
