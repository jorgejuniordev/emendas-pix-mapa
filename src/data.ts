// [parlamentar index, ano da emenda, valor pago, valor indicado]
export type Emenda = [number, number, number, number]

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
  casa: 'Deputado' | 'Senador' | null
  foto: string | null
  url: string | null
}

export function parlLabel(p: Parlamentar, short = false): string {
  const casa = !p.casa ? '' : short ? (p.casa === 'Senador' ? 'Sen.' : 'Dep.') : p.casa
  const sigla = [p.partido, p.uf].filter(Boolean).join('-')
  return [casa, sigla].filter(Boolean).join(' · ')
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
}

export type Metric = 'per_capita' | 'total'
export type Theme = 'claro' | 'escuro'

export interface Filter {
  year: number | null
  parl: number | null
}

export function pagoOf(m: Municipio, anos: number[], { year, parl }: Filter): number {
  if (parl !== null) {
    let sum = 0
    for (const [p, ano, pago] of m.emendas) {
      if (p === parl && (year === null || ano === year)) sum += pago
    }
    return sum
  }
  if (year === null) return m.pago.reduce((a, b) => a + b, 0)
  return m.pago[anos.indexOf(year)] ?? 0
}

export function metricValue(pago: number, m: Municipio, metric: Metric): number {
  if (metric === 'total') return pago
  return m.pop ? pago / m.pop : 0
}

// Viridis: perceptually uniform and readable under the common types of color blindness
export const SCALE = ['#fde725', '#7ad151', '#22a884', '#2a788e', '#414487', '#440154']

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

export function formatBRL(v: number, compact = true): string {
  if (!compact || Math.abs(v) < 1000) {
    const digits = Number.isInteger(v) || v >= 100 ? 0 : 2
    return v.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  }
  const units: [number, string][] = [
    [1e9, 'bi'],
    [1e6, 'mi'],
    [1e3, 'mil'],
  ]
  const [div, label] = units.find(([d]) => Math.abs(v) >= d)!
  const n = v / div
  return `R$ ${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 1 : 0 })} ${label}`
}

export function formatMetric(v: number, metric: Metric): string {
  return metric === 'per_capita' ? `${formatBRL(v, false)}/hab.` : formatBRL(v)
}

export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE',
  'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]
