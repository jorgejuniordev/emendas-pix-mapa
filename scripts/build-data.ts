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
const RETRIES = 4
const MUNICIPIO_SIMILARITY = 0.75
const PESSOA_SIMILARITY = 0.8

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

// Transferegov author names that the Câmara lists under another name (Câmara deputy id)
const DEPUTY_ALIASES: Record<string, number> = {
  Bozzella: 204502,
  'Major Vitor Hugo': 179587,
  'Vavá Martins': 204505,
  'Luizão Goulart': 204418,
  'Dayany Bittencourt': 220659,
  'Rafael Fera': 233594,
}

// Legislatures covering the emendas Pix era (EC 105/2019 onwards)
const LEGISLATURAS = [56, 57]

type Pessoa = {
  key: string
  nome: string
  partido: string | null
  uf: string | null
  casa: 'Deputado' | 'Senador'
  foto: string | null
  url: string
  ultimaLegislatura: number
  titular: boolean
}

type MunicipioIbge = { id: string; nome: string; uf: string }

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

type DeputadoApi = {
  id: number
  nome: string
  siglaPartido: string
  siglaUf: string
  idLegislatura: number
  urlFoto: string
}

type MandatoSenado = {
  UfParlamentar?: string
  DescricaoParticipacao?: string
  PrimeiraLegislaturaDoMandato?: { NumeroLegislatura: string }
  SegundaLegislaturaDoMandato?: { NumeroLegislatura: string }
  Exercicios?: unknown
}

type SenadorApi = {
  IdentificacaoParlamentar: {
    CodigoParlamentar: string
    NomeParlamentar: string
    SiglaPartidoParlamentar?: string
    UrlFotoParlamentar?: string
  }
  Mandatos: { Mandato: MandatoSenado | MandatoSenado[] }
}

// [parlamentar, ano, pago, indicado]
type EmendaMunicipio = [number, number, number, number]
// [parlamentar, ano, pago]
type EmendaEstado = [number, number, number]

type MunicipioAcc = { pago: number[]; indicado: number[]; emendas: Map<string, EmendaMunicipio> }

type Aggregation = {
  porMunicipio: Map<string, MunicipioAcc>
  porEstado: Map<string, number[]>
  emendasEstado: Map<string, Map<string, EmendaEstado>>
  unmatched: Map<string, number>
  ufPorParlamentar: Map<number, Map<string, number>>
}

type Transferencias = {
  planos: PlanoAcao[]
  empenhos: Empenho[]
  documentos: DocumentoHabil[]
  ordens: OrdemBancaria[]
}

// ---------- generic helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const round = (n: number) => Math.round(n)
const bi = (n: number) => `R$ ${(n / 1e9).toFixed(2)} bi`

function addTo<K>(map: Map<K, number>, key: K, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value)
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key)
  if (existing !== undefined) return existing
  const value = create()
  map.set(key, value)
  return value
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) getOrCreate(groups, keyOf(item), () => []).push(item)
  return groups
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

// First item with the highest score
function bestBy<T>(items: Iterable<T>, score: (item: T) => number): [T, number] | null {
  let best: [T, number] | null = null
  for (const item of items) {
    const s = score(item)
    if (!best || s > best[1]) best = [item, s]
  }
  return best
}

// ---------- HTTP

async function withRetry<T>(run: () => Promise<T>, onRetry?: (attempt: number) => void): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run()
    } catch (err) {
      if (i >= RETRIES) throw err
      onRetry?.(i)
      await sleep(2000 * i)
    }
  }
}

async function getJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return (await res.json()) as T
}

function fetchJson<T>(url: string): Promise<T> {
  return withRetry(
    () => getJson<T>(url, { signal: AbortSignal.timeout(180_000) }),
    (i) => console.warn(`  retry ${i} ${url}`),
  )
}

function fetchJsonAccept<T>(url: string): Promise<T> {
  return withRetry(() =>
    getJson<T>(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(120_000) }),
  )
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
  const worker = async () => {
    while (next < offsets.length) {
      const i = next++
      pages[i] = await fetchJson<T[]>(`${TRANSFEREGOV}/${table}?order=${orderBy}&offset=${offsets[i]}&limit=${PAGE}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  const rows = pages.flat()
  if (rows.length < total) throw new Error(`${table}: ${rows.length} de ${total} linhas`)
  console.log(`  ${table}: ${rows.length.toLocaleString('pt-BR')} linhas`)
  return rows
}

// ---------- name matching

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

const compact = (s: string) => normalize(s).replace(/[^A-Z]/g, '')

const isState = (name: string) => /^ESTADO (DE|DO|DA) /.test(normalize(name))

function cleanBeneficiary(name: string) {
  return normalize(name)
    .replace(/PREFEITURA MUNICIPAL( DE| DO| DA)?/g, '')
    .replace(/^\s*MUNICIPIO (DE |DO |DA |DOS |DAS )?/, '')
    .replace(/^(DA )?ESTANCIA (TURISTICA|BALNEARIA|HIDROMINERAL|CLIMATICA) DE /, '')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const grams = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) addTo(grams, s.slice(i, i + 2), 1)
  return grams
}

// Dice coefficient over bigrams; good enough for spelling variants like JAHU/JAU, GOUVEA/GOUVEIA
function similarity(a: string, b: string) {
  const gb = bigrams(b)
  let overlap = 0
  for (const [g, n] of bigrams(a)) overlap += Math.min(n, gb.get(g) ?? 0)
  return (2 * overlap) / Math.max(1, a.length - 1 + b.length - 1)
}

// ---------- IBGE

function ufOfLocalidade(m: {
  microrregiao: { mesorregiao: { UF: { sigla: string } } } | null
  'regiao-imediata'?: { 'regiao-intermediaria': { UF: { sigla: string } } }
}): string {
  return m.microrregiao?.mesorregiao.UF.sigla ?? m['regiao-imediata']?.['regiao-intermediaria'].UF.sigla ?? ''
}

async function loadMunicipios(): Promise<MunicipioIbge[]> {
  console.log('Municípios (IBGE localidades)')
  const list = await fetchJson<
    ({ id: number; nome: string } & Parameters<typeof ufOfLocalidade>[0])[]
  >('https://servicodados.ibge.gov.br/api/v1/localidades/municipios')
  return list.map((m) => ({ id: String(m.id), nome: m.nome, uf: ufOfLocalidade(m) }))
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

function buildMatcher(municipios: MunicipioIbge[]) {
  const byUf = new Map<string, Map<string, string>>()
  for (const m of municipios) getOrCreate(byUf, m.uf, () => new Map()).set(compact(m.nome), m.id)
  const nomeOf = new Map(municipios.map((m) => [m.id, m.nome]))
  const fuzzy: string[] = []
  const cache = new Map<string, string | null>()

  const resolve = (name: string, uf: string): string | null => {
    const cleaned = cleanBeneficiary(name)
    const known = ALIASES[`${cleaned}|${uf}`] ?? byUf.get(uf)?.get(compact(cleaned))
    if (known) return known
    const best = bestBy(byUf.get(uf) ?? [], ([n]) => similarity(compact(cleaned), n))
    if (!best || best[1] < MUNICIPIO_SIMILARITY) return null
    const id = best[0][1]
    fuzzy.push(`${uf} ${name} -> ${nomeOf.get(id)}`)
    return id
  }

  return {
    fuzzy,
    match(name: string, uf: string): string | null {
      const key = `${name}|${uf}`
      if (cache.has(key)) return cache.get(key)!
      const id = resolve(name, uf)
      cache.set(key, id)
      return id
    },
  }
}

// ---------- Câmara / Senado

function deputadoFromApi(d: DeputadoApi): Pessoa {
  return {
    key: `D${d.id}`,
    nome: d.nome,
    partido: d.siglaPartido || null,
    uf: d.siglaUf || null,
    casa: 'Deputado',
    foto: d.urlFoto || null,
    url: `https://www.camara.leg.br/deputados/${d.id}`,
    ultimaLegislatura: d.idLegislatura,
    titular: true,
  }
}

async function loadDeputados(): Promise<Map<string, Pessoa>> {
  const deputados = new Map<string, Pessoa>()
  const legs = LEGISLATURAS.map((l) => `idLegislatura=${l}`).join('&')
  for (let pagina = 1; ; pagina++) {
    const { dados } = await fetchJsonAccept<{ dados: DeputadoApi[] }>(
      `https://dadosabertos.camara.leg.br/api/v2/deputados?${legs}&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=idLegislatura`,
    )
    if (!dados.length) return deputados
    for (const d of dados) {
      const cur = deputados.get(`D${d.id}`)
      if (cur && cur.ultimaLegislatura > d.idLegislatura) continue
      deputados.set(`D${d.id}`, deputadoFromApi(d))
    }
  }
}

function legislaturasDe(m: MandatoSenado): number[] {
  return [m.PrimeiraLegislaturaDoMandato, m.SegundaLegislaturaDoMandato]
    .filter(Boolean)
    .map((l) => Number(l!.NumeroLegislatura))
}

function senadorFoto(codigo: string, url: string | undefined): string {
  return (url ?? `https://www.senado.leg.br/senadores/img/fotos-oficiais/senador${codigo}.jpg`).replace(/^http:/, 'https:')
}

function senadorFromApi(s: SenadorApi): Pessoa | null {
  // The list includes suplentes who never took office; only count mandates actually exercised
  const exercidos = asArray(s.Mandatos.Mandato).filter((m) => m.Exercicios)
  if (!exercidos.length) return null
  const id = s.IdentificacaoParlamentar
  return {
    key: `S${id.CodigoParlamentar}`,
    nome: id.NomeParlamentar,
    partido: id.SiglaPartidoParlamentar ?? null,
    uf: exercidos.at(-1)!.UfParlamentar ?? null,
    casa: 'Senador',
    foto: senadorFoto(id.CodigoParlamentar, id.UrlFotoParlamentar),
    url: `https://www25.senado.leg.br/web/senadores/senador/-/perfil/${id.CodigoParlamentar}`,
    ultimaLegislatura: Math.max(...exercidos.flatMap(legislaturasDe)),
    titular: exercidos.some((m) => m.DescricaoParticipacao === 'Titular'),
  }
}

async function loadSenadores(): Promise<Map<string, Pessoa>> {
  const res = await fetchJsonAccept<{
    ListaParlamentarLegislatura: { Parlamentares: { Parlamentar: SenadorApi[] } }
  }>(`https://legis.senado.leg.br/dadosabertos/senador/lista/legislatura/${LEGISLATURAS[0]}/${LEGISLATURAS.at(-1)}`)
  const senadores = new Map<string, Pessoa>()
  for (const s of res.ListaParlamentarLegislatura.Parlamentares.Parlamentar) {
    const pessoa = senadorFromApi(s)
    if (pessoa) senadores.set(pessoa.key, pessoa)
  }
  return senadores
}

async function loadPessoas(): Promise<Pessoa[]> {
  console.log('Deputados (Câmara) e senadores (Senado)')
  const deputados = await loadDeputados()
  const senadores = await loadSenadores()
  const list = [...deputados.values(), ...senadores.values()]
  console.log(`  ${deputados.size} deputados, ${senadores.size} senadores`)
  return list
}

const pessoaKey = (s: string) => compact(s.replace(/^(Dr|Dra)\.\s*/i, ''))

// Same person as deputy and senator: keep the most recent role. On ties a suplente who briefly
// took a Senate seat stays a deputy; an elected senator wins.
function roleRank(p: Pessoa): number {
  if (p.casa === 'Deputado') return 1
  return p.titular ? 2 : 0
}

function mostRecent(cands: Pessoa[]): Pessoa {
  return [...cands].sort((a, b) => b.ultimaLegislatura - a.ultimaLegislatura || roleRank(b) - roleRank(a))[0]
}

function matchPessoas(nomes: string[], ufPrincipal: (string | null)[], pessoas: Pessoa[]) {
  const byName = groupBy(pessoas, (p) => pessoaKey(p.nome))
  const byKey = new Map(pessoas.map((p) => [p.key, p]))
  const fuzzy: string[] = []
  const missing: string[] = []

  const resolve = (nome: string, uf: string | null): Pessoa | null => {
    const alias = DEPUTY_ALIASES[nome]
    if (alias) return byKey.get(`D${alias}`) ?? null

    const exact = byName.get(pessoaKey(nome)) ?? []
    const sameUf = exact.filter((p) => p.uf === uf)
    if (sameUf.length) return mostRecent(sameUf)
    if (exact.length) {
      fuzzy.push(`${nome} (${uf}) -> ${exact[0].nome} (${exact[0].casa}-${exact[0].uf}, outro estado)`)
      return mostRecent(exact)
    }

    const best = bestBy(
      pessoas.filter((p) => p.uf === uf),
      (p) => similarity(pessoaKey(nome), pessoaKey(p.nome)),
    )
    if (!best || best[1] < PESSOA_SIMILARITY) {
      missing.push(`${nome} (${uf})`)
      return null
    }
    fuzzy.push(`${nome} (${uf}) -> ${best[0].nome} (${best[0].casa})`)
    return best[0]
  }

  const result = nomes.map((nome, i) => resolve(nome, ufPrincipal[i]))
  return { result, fuzzy, missing }
}

// ---------- Transferegov

async function loadTransferencias(): Promise<Transferencias> {
  console.log('Transferências especiais (Transferegov)')
  const planos = await fetchTable<PlanoAcao>('plano_acao_especial', 'id_plano_acao')
  const empenhos = await fetchTable<Empenho>('empenho_especial', 'id_empenho')
  const documentos = await fetchTable<DocumentoHabil>('documento_habil_especial', 'id_dh')
  const ordens = await fetchTable<OrdemBancaria>('ordem_pagamento_ordem_bancaria_especial', 'id_op_ob')
  return { planos, empenhos, documentos, ordens }
}

// Paid = documento hábil with a bank order sent to the bank (OB), traced back to its plano de ação
function computePagoPorPlano({ empenhos, documentos, ordens }: Transferencias): Map<number, number> {
  const planoOfEmpenho = new Map(empenhos.map((e) => [e.id_empenho, e.id_plano_acao]))
  const dhWithOb = new Set(ordens.filter((o) => o.numero_ordem_bancaria).map((o) => o.id_dh))
  const pagoPorPlano = new Map<number, number>()
  for (const d of documentos) {
    if (!dhWithOb.has(d.id_dh)) continue
    const plano = planoOfEmpenho.get(d.id_empenho)
    if (plano === undefined) continue
    addTo(pagoPorPlano, plano, d.valor_dh ?? 0)
  }
  return pagoPorPlano
}

const isAllCaps = (s: string) => s === s.toUpperCase()

const authorName = (p: PlanoAcao) => (p.nome_parlamentar_emenda_plano_acao ?? '').replace(/^Dep\.\s*/, '').trim()

function isBetterName(cur: { nome: string; ano: number } | undefined, nome: string, ano: number): boolean {
  if (!cur) return true
  if (isAllCaps(cur.nome) && !isAllCaps(nome)) return true
  return isAllCaps(cur.nome) === isAllCaps(nome) && ano > cur.ano
}

// Same author code shows up with spelling variants ("Otaci"/"Ottaci", all caps); keep the latest
// mixed-case name. Codes that end up with the same name (deputy who became senator) are merged.
function resolveAuthorNames(planos: PlanoAcao[]): Map<string, { nome: string; ano: number }> {
  const nameOfCode = new Map<string, { nome: string; ano: number }>()
  for (const p of planos) {
    const code = p.codigo_parlamentar_emenda_plano_acao ?? ''
    const nome = authorName(p)
    if (!nome) continue
    if (isBetterName(nameOfCode.get(code), nome, p.ano_plano_acao)) nameOfCode.set(code, { nome, ano: p.ano_plano_acao })
  }
  return nameOfCode
}

function createAutorRegistry(planos: PlanoAcao[]) {
  const nameOfCode = resolveAuthorNames(planos)
  const nomes: string[] = []
  const indexByNome = new Map<string, number>()
  const indexOf = (p: PlanoAcao): number => {
    const nome = nameOfCode.get(p.codigo_parlamentar_emenda_plano_acao ?? '')?.nome ?? 'Não informado'
    return getOrCreate(indexByNome, nome, () => nomes.push(nome) - 1)
  }
  return { nomes, indexOf }
}

type AggregationContext = {
  anos: number[]
  pagoPorPlano: Map<number, number>
  autores: ReturnType<typeof createAutorRegistry>
  matcher: ReturnType<typeof buildMatcher>
}

type PlanoValores = { pago: number; indicado: number; anoIdx: number }

function countUf(agg: Aggregation, parl: number, uf: string, indicado: number): void {
  addTo(getOrCreate(agg.ufPorParlamentar, parl, () => new Map()), uf, indicado)
}

function addPlanoEstado(agg: Aggregation, p: PlanoAcao, v: PlanoValores, ctx: AggregationContext): void {
  const uf = p.uf_beneficiario_plano_acao
  getOrCreate(agg.porEstado, uf, () => ctx.anos.map(() => 0))[v.anoIdx] += v.pago
  const parl = ctx.autores.indexOf(p)
  countUf(agg, parl, uf, v.indicado)
  const emendas = getOrCreate(agg.emendasEstado, uf, () => new Map())
  const em = getOrCreate(emendas, `${parl}|${p.ano_plano_acao}`, (): EmendaEstado => [parl, p.ano_plano_acao, 0])
  em[2] += v.pago
}

function addPlanoMunicipio(agg: Aggregation, id: string, p: PlanoAcao, v: PlanoValores, ctx: AggregationContext): void {
  const zeros = () => ctx.anos.map(() => 0)
  const acc = getOrCreate(agg.porMunicipio, id, () => ({ pago: zeros(), indicado: zeros(), emendas: new Map() }))
  acc.pago[v.anoIdx] += v.pago
  acc.indicado[v.anoIdx] += v.indicado
  const parl = ctx.autores.indexOf(p)
  countUf(agg, parl, p.uf_beneficiario_plano_acao, v.indicado)
  const em = getOrCreate(acc.emendas, `${parl}|${p.ano_plano_acao}`, (): EmendaMunicipio => [parl, p.ano_plano_acao, 0, 0])
  em[2] += v.pago
  em[3] += v.indicado
}

function addPlano(agg: Aggregation, p: PlanoAcao, ctx: AggregationContext): void {
  const valores: PlanoValores = {
    indicado: (p.valor_custeio_plano_acao ?? 0) + (p.valor_investimento_plano_acao ?? 0),
    pago: ctx.pagoPorPlano.get(p.id_plano_acao) ?? 0,
    anoIdx: ctx.anos.indexOf(p.ano_plano_acao),
  }
  const nome = p.nome_beneficiario_plano_acao
  const uf = p.uf_beneficiario_plano_acao
  if (isState(nome)) return addPlanoEstado(agg, p, valores, ctx)

  const id = ctx.matcher.match(nome, uf)
  if (!id) return addTo(agg.unmatched, `${nome} (${uf})`, valores.pago)
  addPlanoMunicipio(agg, id, p, valores, ctx)
}

function aggregatePlanos(planos: PlanoAcao[], ctx: AggregationContext): Aggregation {
  const agg: Aggregation = {
    porMunicipio: new Map(),
    porEstado: new Map(),
    emendasEstado: new Map(),
    unmatched: new Map(),
    ufPorParlamentar: new Map(),
  }
  for (const p of planos) addPlano(agg, p, ctx)
  return agg
}

// Parliamentarians send emendas to their own state, so the main destination validates name matches
function principalUf(ufs: Map<string, number> | undefined): string | null {
  const ranked = [...(ufs ?? [])].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? null
}

// ---------- output

function toParlamentarOut(nome: string, pessoa: Pessoa | null, ufPrincipal: string | null) {
  if (!pessoa) return { nome, partido: null, uf: ufPrincipal, casa: null, foto: null, url: null }
  return { nome, partido: pessoa.partido, uf: pessoa.uf, casa: pessoa.casa, foto: pessoa.foto, url: pessoa.url }
}

function toMunicipioOut(m: MunicipioIbge, acc: MunicipioAcc | undefined, pop: number | null, zeros: () => number[]) {
  return {
    id: m.id,
    nome: m.nome,
    uf: m.uf,
    pop,
    pago: (acc?.pago ?? zeros()).map(round),
    indicado: (acc?.indicado ?? zeros()).map(round),
    emendas: [...(acc?.emendas.values() ?? [])]
      .map(([parl, ano, pago, indicado]) => [parl, ano, round(pago), round(indicado)])
      .sort((a, b) => b[2] - a[2]),
  }
}

function serializeEmendasEstado(emendasEstado: Aggregation['emendasEstado']) {
  return Object.fromEntries(
    [...emendasEstado].map(([uf, ems]) => [
      uf,
      [...ems.values()].filter((e) => e[2] > 0).map(([parl, ano, pago]) => [parl, ano, round(pago)]),
    ]),
  )
}

function buildMeta(anos: number[], populacaoAno: string, totalPago: number) {
  return {
    geradoEm: new Date().toISOString(),
    anos,
    populacaoAno,
    totalPago: round(totalPago),
    fontes: {
      emendas:
        'Transferegov, API de Transferências Especiais (emendas Pix): plano de ação, empenho, documento hábil e ordem bancária',
      populacao: `IBGE, população residente estimada ${populacaoAno} (SIDRA 6579)`,
      parlamentares:
        'Câmara dos Deputados e Senado Federal, dados abertos: partido, estado e foto mais recentes',
      malha: 'IBGE, malha municipal',
    },
  }
}

type SummaryInput = {
  totalPago: number
  pagoMunicipios: number
  agg: Aggregation
  matcherFuzzy: string[]
  parlamentares: number
  matched: ReturnType<typeof matchPessoas>
}

function logSummary({ totalPago, pagoMunicipios, agg, matcherFuzzy, parlamentares, matched }: SummaryInput): void {
  const pagoEstados = sum([...agg.porEstado.values()].flat())
  const pagoSemMatch = sum([...agg.unmatched.values()])
  console.log(`Correspondência aproximada de nomes (${matcherFuzzy.length}):`)
  for (const f of matcherFuzzy) console.log(`  ${f}`)
  if (agg.unmatched.size) console.warn('Sem correspondência:', [...agg.unmatched.keys()])
  console.log(`Parlamentares: ${parlamentares - matched.missing.length} de ${parlamentares} identificados`)
  for (const f of matched.fuzzy) console.log(`  ${f}`)
  if (matched.missing.length) console.warn('  Não identificados:', matched.missing)
  console.log(
    `OK: pago ${bi(totalPago)} = municípios ${bi(pagoMunicipios)} + estados ${bi(pagoEstados)} + sem município ${bi(pagoSemMatch)}. ${agg.porMunicipio.size} municípios receberam.`,
  )
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })

  const municipios = await loadMunicipios()
  const populacao = await loadPopulacao()
  const mesh = (await loadMesh()) as { features: { properties: Record<string, unknown> }[] }
  const transferencias = await loadTransferencias()

  const pagoPorPlano = computePagoPorPlano(transferencias)
  const anos = [...new Set(transferencias.planos.map((p) => p.ano_plano_acao))].sort((a, b) => a - b)
  const zeros = () => anos.map(() => 0)
  const autores = createAutorRegistry(transferencias.planos)
  const matcher = buildMatcher(municipios)
  const agg = aggregatePlanos(transferencias.planos, { anos, pagoPorPlano, autores, matcher })

  const ufPrincipal = autores.nomes.map((_, i) => principalUf(agg.ufPorParlamentar.get(i)))
  const pessoas = await loadPessoas()
  const matched = matchPessoas(autores.nomes, ufPrincipal, pessoas)
  const parlamentares = autores.nomes.map((nome, i) => toParlamentarOut(nome, matched.result[i], ufPrincipal[i]))
  const out = municipios.map((m) =>
    toMunicipioOut(m, agg.porMunicipio.get(m.id), populacao.byId.get(m.id) ?? null, zeros),
  )

  for (const f of mesh.features) f.properties = { id: String(f.properties.codarea) }

  const totalPago = sum([...pagoPorPlano.values()])
  await writeFile(
    path.join(OUT_DIR, 'emendas.json'),
    JSON.stringify({
      meta: buildMeta(anos, populacao.ano, totalPago),
      parlamentares,
      municipios: out,
      estados: Object.fromEntries([...agg.porEstado].map(([uf, v]) => [uf, v.map(round)])),
      emendasEstado: serializeEmendasEstado(agg.emendasEstado),
    }),
  )
  await writeFile(path.join(OUT_DIR, 'municipios.geojson'), JSON.stringify(mesh))

  logSummary({
    totalPago,
    pagoMunicipios: out.reduce((s, m) => s + sum(m.pago), 0),
    agg,
    matcherFuzzy: matcher.fuzzy,
    parlamentares: autores.nomes.length,
    matched,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
