import type { Dataset, Theme } from './data'

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
      <a href="https://www.linkedin.com/in/jorgejuniordeveloper/" target="_blank" rel="noopener noreferrer">
        Jorge Souza
      </a>
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
