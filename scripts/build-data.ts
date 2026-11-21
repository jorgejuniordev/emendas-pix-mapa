import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const RAW_DIR = path.join(ROOT, 'data-raw')
const OUT_DIR = path.join(ROOT, 'public', 'data')

const TRANSFEREGOV = 'https://api.transferegov.gestao.gov.br/transferenciasespeciais'
const SIDRA = 'https://apisidra.ibge.gov.br/values'
const MESH_URL =
  'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima'
const PAGE = 1000
const CONCURRENCY = 6

// Beneficiary names in Transferegov that fuzzy matching can't resolve: renamed or old spellings
const ALIASES: Record<string, string> = {
  'JAHU|SP': '3525300',
  'GOUVEA|MG': '3127602',
  'ARES|RN': '2401206',
  'FORTALEZA DO TABOCAO|TO': '1708254',
  'SAO LUIZ|RR': '1400605',
  'SAO VALERIO DA NATIVIDADE|TO': '1720499',
  'BOA SAUDE|RN': '2405306',
  'BOM JESUS|GO': '5203500',
  'PRESIDENTE JUSCELINO|RN': '2410306',
  'DISTRITO FEDERAL|DF': '5300108',
}

type PlanoAcao = {
  id_plano_acao: number
  ano_plano_acao: number
  situacao_plano_acao: string
  nome_beneficiario_plano_acao: string
  uf_beneficiario_plano_acao: string
  nome_parlamentar_emenda_plano_acao: string | null
  codigo_parlamentar_emenda_plano_acao: string | null
  valor_custeio_plano_acao: number | null
  valor_investimento_plano_acao: number | null
}
type Empenho = { id_empenho: number; id_plano_acao: number }
type DocumentoHabil = { id_dh: number; id_empenho: number; valor_dh: number | null }
type OrdemBancaria = { id_dh: number; numero_ordem_bancaria: string | null }

async function fetchJson<T>(url: string, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      return (await res.json()) as T
    } catch (err) {
      if (i >= attempts) throw err
      console.warn(`  retry ${i} ${url}`)
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

async function exists(p: string) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function countRows(table: string): Promise<number> {
  const res = await fetch(`${TRANSFEREGOV}/${table}?limit=1`, {
    headers: { Prefer: 'count=exact' },
    signal: AbortSignal.timeout(60_000),
  })
  const total = Number(res.headers.get('content-range')?.split('/')[1])
  if (!Number.isFinite(total)) throw new Error(`Sem contagem para ${table}`)
  return total
}

async function fetchTable<T>(table: string, orderBy: string): Promise<T[]> {
  const total = await countRows(table)
  const offsets = Array.from({ length: Math.ceil(total / PAGE) + 1 }, (_, i) => i * PAGE)
  const pages: T[][] = new Array(offsets.length)
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < offsets.length) {
        const i = next++
        pages[i] = await fetchJson<T[]>(
          `${TRANSFEREGOV}/${table}?order=${orderBy}&offset=${offsets[i]}&limit=${PAGE}`,
        )
      }
    }),
  )
  const rows = pages.flat()
  if (rows.length < total) throw new Error(`${table}: ${rows.length} de ${total} linhas`)
  console.log(`  ${table}: ${rows.length.toLocaleString('pt-BR')} linhas`)
  return rows
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

const compact = (s: string) => normalize(s).replace(/[^A-Z]/g, '')

function cleanBeneficiary(name: string) {
  return normalize(name)
    .replace(/PREFEITURA MUNICIPAL( DE| DO| DA)?/g, '')
    .replace(/^\s*MUNICIPIO (DE |DO |DA |DOS |DAS )?/, '')
    .replace(/^(DA )?ESTANCIA (TURISTICA|BALNEARIA|HIDROMINERAL|CLIMATICA) DE /, '')
    .trim()
}

function similarity(a: string, b: string) {
  // Dice coefficient over bigrams; good enough for spelling variants like JAHU/JAU, GOUVEA/GOUVEIA
  const grams = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1)
    return m
  }
  const ga = grams(a)
  const gb = grams(b)
  let overlap = 0
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0)
  return (2 * overlap) / Math.max(1, a.length - 1 + b.length - 1)
}

async function loadMunicipios() {
  console.log('Municípios (IBGE localidades)')
  const list = await fetchJson<
    {
      id: number
      nome: string
      microrregiao: { mesorregiao: { UF: { sigla: string } } } | null
      'regiao-imediata'?: { 'regiao-intermediaria': { UF: { sigla: string } } }
    }[]
  >('https://servicodados.ibge.gov.br/api/v1/localidades/municipios')
  return list.map((m) => ({
    id: String(m.id),
    nome: m.nome,
    uf:
      m.microrregiao?.mesorregiao.UF.sigla ??
      m['regiao-imediata']?.['regiao-intermediaria'].UF.sigla ??
      '',
  }))
}

async function loadPopulacao() {
  console.log('População estimada (SIDRA 6579)')
  const rows = (await fetchJson<Record<string, string>[]>(`${SIDRA}/t/6579/n6/all/v/9324/p/last`)).slice(1)
  return {
    ano: rows[0]?.D3N ?? '',
    byId: new Map(rows.map((r) => [r.D1C, Number(r.V) || null])),
  }
}

async function loadMesh() {
  console.log('Malha municipal (IBGE)')
  const cache = path.join(RAW_DIR, 'malha_municipios.json')
  if (await exists(cache)) return JSON.parse(await readFile(cache, 'utf8'))
  const mesh = await fetchJson<unknown>(MESH_URL)
  await writeFile(cache, JSON.stringify(mesh))
  return mesh
}

function buildMatcher(municipios: { id: string; nome: string; uf: string }[]) {
  const byUf = new Map<string, Map<string, string>>()
  for (const m of municipios) {
    if (!byUf.has(m.uf)) byUf.set(m.uf, new Map())
    byUf.get(m.uf)!.set(compact(m.nome), m.id)
  }
  const fuzzy: string[] = []
  const cache = new Map<string, string | null>()

  return {
    fuzzy,
    match(name: string, uf: string): string | null {
      const key = `${name}|${uf}`
      if (cache.has(key)) return cache.get(key)!
      const cleaned = cleanBeneficiary(name)
      const exact = byUf.get(uf)?.get(compact(cleaned))
      let id = ALIASES[`${cleaned}|${uf}`] ?? exact ?? null
      if (!id) {
        let best: [string, number] | null = null
        for (const [n, mid] of byUf.get(uf) ?? []) {
          const s = similarity(compact(cleaned), n)
          if (!best || s > best[1]) best = [mid, s]
        }
        if (best && best[1] >= 0.75) {
          id = best[0]
          fuzzy.push(`${uf} ${name} -> ${municipios.find((m) => m.id === id)!.nome}`)
        }
      }
      cache.set(key, id)
      return id
    },
  }
}

const isState = (name: string) => /^ESTADO (DE|DO|DA) /.test(normalize(name))

async function main() {
  await mkdir(RAW_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })

  const municipios = await loadMunicipios()
  const populacao = await loadPopulacao()
  const mesh = (await loadMesh()) as { features: { properties: Record<string, unknown> }[] }

  console.log('Transferências especiais (Transferegov)')
  const planos = await fetchTable<PlanoAcao>('plano_acao_especial', 'id_plano_acao')
  const empenhos = await fetchTable<Empenho>('empenho_especial', 'id_empenho')
  const documentos = await fetchTable<DocumentoHabil>('documento_habil_especial', 'id_dh')
  const ordens = await fetchTable<OrdemBancaria>('ordem_pagamento_ordem_bancaria_especial', 'id_op_ob')

  // Paid = documento hábil with a bank order sent to the bank (OB), traced back to its plano de ação
  const planoOfEmpenho = new Map(empenhos.map((e) => [e.id_empenho, e.id_plano_acao]))
  const dhWithOb = new Set(ordens.filter((o) => o.numero_ordem_bancaria).map((o) => o.id_dh))
  const pagoPorPlano = new Map<number, number>()
  for (const d of documentos) {
    if (!dhWithOb.has(d.id_dh)) continue
    const plano = planoOfEmpenho.get(d.id_empenho)
    if (plano === undefined) continue
    pagoPorPlano.set(plano, (pagoPorPlano.get(plano) ?? 0) + (d.valor_dh ?? 0))
  }

  const anos = [...new Set(planos.map((p) => p.ano_plano_acao))].sort((a, b) => a - b)
  const anoIdx = new Map(anos.map((a, i) => [a, i]))
  const zeros = () => anos.map(() => 0)

  // Same author code shows up with spelling variants ("Otaci"/"Ottaci", all caps); keep the latest
  // mixed-case name. Codes that end up with the same name (deputy who became senator) are merged.
  const isAllCaps = (s: string) => s === s.toUpperCase()
  const nameOfCode = new Map<string, { nome: string; ano: number }>()
  for (const p of planos) {
    const code = p.codigo_parlamentar_emenda_plano_acao ?? ''
    const nome = (p.nome_parlamentar_emenda_plano_acao ?? '').replace(/^Dep\.\s*/, '').trim()
    if (!nome) continue
    const cur = nameOfCode.get(code)
    const better =
      !cur ||
      (isAllCaps(cur.nome) && !isAllCaps(nome)) ||
      (isAllCaps(cur.nome) === isAllCaps(nome) && p.ano_plano_acao > cur.ano)
    if (better) nameOfCode.set(code, { nome, ano: p.ano_plano_acao })
  }

  const parlamentares: string[] = []
  const parlIdx = new Map<string, number>()
  const parlOf = (p: PlanoAcao) => {
    const nome = nameOfCode.get(p.codigo_parlamentar_emenda_plano_acao ?? '')?.nome ?? 'Não informado'
    if (!parlIdx.has(nome)) {
      parlIdx.set(nome, parlamentares.length)
      parlamentares.push(nome)
    }
    return parlIdx.get(nome)!
  }

  const matcher = buildMatcher(municipios)
  type Acc = { pago: number[]; indicado: number[]; emendas: Map<string, [number, number, number, number]> }
  const porMunicipio = new Map<string, Acc>()
  const porEstado = new Map<string, number[]>()
  const unmatched = new Map<string, number>()

  for (const p of planos) {
    const indicado = (p.valor_custeio_plano_acao ?? 0) + (p.valor_investimento_plano_acao ?? 0)
    const pago = pagoPorPlano.get(p.id_plano_acao) ?? 0
    const ai = anoIdx.get(p.ano_plano_acao)!
    const nome = p.nome_beneficiario_plano_acao
    const uf = p.uf_beneficiario_plano_acao

    if (isState(nome)) {
      const acc = porEstado.get(uf) ?? zeros()
      acc[ai] += pago
      porEstado.set(uf, acc)
      continue
    }

    const id = matcher.match(nome, uf)
    if (!id) {
      unmatched.set(`${nome} (${uf})`, (unmatched.get(`${nome} (${uf})`) ?? 0) + pago)
      continue
    }
    const acc = porMunicipio.get(id) ?? { pago: zeros(), indicado: zeros(), emendas: new Map() }
    acc.pago[ai] += pago
    acc.indicado[ai] += indicado
    const parl = parlOf(p)
    const key = `${parl}|${p.ano_plano_acao}`
    const em = acc.emendas.get(key) ?? [parl, p.ano_plano_acao, 0, 0]
    em[2] += pago
    em[3] += indicado
    acc.emendas.set(key, em)
    porMunicipio.set(id, acc)
  }

  const round = (n: number) => Math.round(n)
  const out = municipios.map((m) => {
    const acc = porMunicipio.get(m.id)
    return {
      id: m.id,
      nome: m.nome,
      uf: m.uf,
      pop: populacao.byId.get(m.id) ?? null,
      pago: (acc?.pago ?? zeros()).map(round),
      indicado: (acc?.indicado ?? zeros()).map(round),
      emendas: [...(acc?.emendas.values() ?? [])]
        .map(([parl, ano, pago, indicado]) => [parl, ano, round(pago), round(indicado)])
        .sort((a, b) => b[2] - a[2]),
    }
  })

  for (const f of mesh.features) f.properties = { id: String(f.properties.codarea) }

  const totalPago = [...pagoPorPlano.values()].reduce((a, b) => a + b, 0)
  const meta = {
    geradoEm: new Date().toISOString(),
    anos,
    populacaoAno: populacao.ano,
    totalPago: round(totalPago),
    fontes: {
      emendas:
        'Transferegov, API de Transferências Especiais (emendas Pix): plano de ação, empenho, documento hábil e ordem bancária',
      populacao: `IBGE, população residente estimada ${populacao.ano} (SIDRA 6579)`,
      malha: 'IBGE, malha municipal',
    },
  }

  await writeFile(
    path.join(OUT_DIR, 'emendas.json'),
    JSON.stringify({ meta, parlamentares, municipios: out, estados: Object.fromEntries([...porEstado].map(([uf, v]) => [uf, v.map(round)])) }),
  )
  await writeFile(path.join(OUT_DIR, 'municipios.geojson'), JSON.stringify(mesh))

  const pagoMunicipios = out.reduce((s, m) => s + m.pago.reduce((a, b) => a + b, 0), 0)
  const pagoEstados = [...porEstado.values()].flat().reduce((a, b) => a + b, 0)
  const pagoSemMatch = [...unmatched.values()].reduce((a, b) => a + b, 0)
  const bi = (n: number) => `R$ ${(n / 1e9).toFixed(2)} bi`
  console.log(`Correspondência aproximada de nomes (${matcher.fuzzy.length}):`)
  for (const f of matcher.fuzzy) console.log(`  ${f}`)
  if (unmatched.size) console.warn('Sem correspondência:', [...unmatched.keys()])
  console.log(
    `OK: pago ${bi(totalPago)} = municípios ${bi(pagoMunicipios)} + estados ${bi(pagoEstados)} + sem município ${bi(pagoSemMatch)}. ${porMunicipio.size} municípios receberam.`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
