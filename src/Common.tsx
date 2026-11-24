import type { ReactNode } from 'react'
import type { Dataset, Theme } from './data'

const AUTHOR_URL = 'https://www.linkedin.com/in/jorgejuniordeveloper/'

export interface Option<T> {
  value: T
  label: string
}

interface SegmentedProps<T> {
  label: string
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export function Segmented<T>({ label, options, value, onChange, className = 'segmented' }: SegmentedProps<T>) {
  return (
    <div className={className} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Bar({ ratio }: { ratio: number }) {
  return (
    <span className="bar-track">
      <span className="bar-fill" style={{ width: `${ratio * 100}%` }} />
    </span>
  )
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

type IconName = 'sun' | 'moon' | 'close' | 'arrow-right' | 'arrow-left' | 'search' | 'map'

const ICON_PATHS: Record<IconName, ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  map: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />,
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  )
}

export function CloseButton({ onClick, label, className = 'icon-button' }: { onClick: () => void; label: string; className?: string }) {
  return (
    <button className={className} onClick={onClick} aria-label={label} title={label}>
      <Icon name="close" size={16} />
    </button>
  )
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'
  return (
    <button className="icon-button theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      <Icon name={theme === 'claro' ? 'moon' : 'sun'} />
    </button>
  )
}

export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Emendas Pix, página inicial">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" />
        <path d="M9 21.5h3.2v-6H9zM14.4 21.5h3.2V11h-3.2zM19.8 21.5H23V7.5h-3.2z" />
      </svg>
      <span className="brand-text">
        <strong>Emendas Pix</strong>
        <span>Monitor de transferências especiais</span>
      </span>
    </a>
  )
}

export type Page = 'home' | 'mapa'

const NAV: { page: Page; href: string; label: string }[] = [
  { page: 'home', href: '#/', label: 'Rankings' },
  { page: 'mapa', href: '#/mapa', label: 'Mapa' },
]

export function TopBar({ page, theme, onToggleTheme }: { page: Page; theme: Theme; onToggleTheme: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <nav className="topbar-nav" aria-label="Seções">
          {NAV.map((n) => (
            <a key={n.page} href={n.href} className={n.page === page ? 'active' : ''} aria-current={n.page === page ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  )
}

export function Credit() {
  return (
    <p className="credit">
      Feito por <ExternalLink href={AUTHOR_URL}>Jorge Souza</ExternalLink>
    </p>
  )
}

const FONTES: { key: keyof Dataset['meta']['fontes']; label: string }[] = [
  { key: 'emendas', label: 'Emendas' },
  { key: 'populacao', label: 'População' },
  { key: 'parlamentares', label: 'Parlamentares' },
  { key: 'malha', label: 'Mapa' },
]

export function Sources({ meta, compact = false }: { meta: Dataset['meta']; compact?: boolean }) {
  return (
    <footer className={`sources ${compact ? 'compact' : ''}`}>
      <div className="sources-inner">
        <div className="sources-method">
          <h2>Fontes e método</h2>
          <p>
            “Pago” é o valor com ordem bancária já enviada ao banco; “indicado” é o que o parlamentar
            destinou no plano de ação. O ano é o da emenda. Só entram as transferências especiais
            (emendas Pix), que caem direto na conta da prefeitura ou do estado sem convênio. Partido e
            estado são os atuais (ou do último mandato) de cada parlamentar, não os da época da emenda.
          </p>
        </div>
        <dl className="sources-list">
          {FONTES.map((f) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{meta.fontes[f.key]}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="sources-bottom">
        <span>Dados atualizados em {new Date(meta.geradoEm).toLocaleDateString('pt-BR')}</span>
        <Credit />
      </div>
    </footer>
  )
}
