import { useState } from 'react'
import type { Parlamentar } from './data'

const initials = (nome: string) =>
  nome
    .replace(/^(Dr|Dra|Pastor|Delegado|Delegada|Coronel|Capitão|Major|Professor|Professora)\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

export function Avatar({ parlamentar, size = 28 }: { parlamentar: Parlamentar; size?: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size, fontSize: size * 0.38 }

  if (!parlamentar.foto || failed) {
    return (
      <span className="avatar avatar-fallback" style={style} aria-hidden>
        {initials(parlamentar.nome)}
      </span>
    )
  }
  return (
    <img
      className="avatar"
      style={style}
      src={parlamentar.foto}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}
