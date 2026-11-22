import type { ReactNode } from 'react'
import type { Dataset, Theme } from './data'

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

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === 'claro' ? 'Ativar modo escuro' : 'Ativar modo claro'
  return (
    <button className="theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      {theme === 'claro' ? '☾' : '☀'}
    </button>
  )
}

export function Credit() {
  return (
    <p className="credit">
      Feito por{' '}
      <ExternalLink href="https://www.linkedin.com/in/jorgejuniordeveloper/">Jorge Souza</ExternalLink>
    </p>
  )
}

export function Sources({ meta }: { meta: Dataset['meta'] }) {
  return (
    <footer className="sources">
      <h2>Fontes e método</h2>
      <ul>
        <li>
          <strong>Emendas:</strong> {meta.fontes.emendas}
        </li>
        <li>
          <strong>População:</strong> {meta.fontes.populacao}
        </li>
        <li>
          <strong>Parlamentares:</strong> {meta.fontes.parlamentares}
        </li>
        <li>
          <strong>Mapa:</strong> {meta.fontes.malha}
        </li>
      </ul>
      <p className="muted">
        “Pago” é o valor com ordem bancária já enviada ao banco; “indicado” é o que o parlamentar
        destinou no plano de ação. O ano é o da emenda. Só entram as transferências especiais
        (emendas Pix), que caem direto na conta da prefeitura ou do estado sem convênio. Partido e
        estado são os atuais (ou do último mandato) de cada parlamentar, não os da época da emenda.
        Dados atualizados em {new Date(meta.geradoEm).toLocaleDateString('pt-BR')}.
      </p>
    </footer>
  )
}
