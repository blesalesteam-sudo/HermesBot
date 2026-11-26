interface Props {
  name: string
  color: string
  src?: string
  size?: number
  status?: 'online' | 'busy' | null
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(w => /^[\p{L}\p{N}]/u.test(w))

  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?'
}

export function Avatar({ name, color, src, size = 36, status = null }: Props) {
  return (
    <span className="avatar" style={{ width: size, height: size, ['--av' as string]: color }} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span style={{ fontSize: Math.round(size * 0.38) }}>{initials(name)}</span>}
      {status && <i className={`avatar-dot ${status}`} />}
    </span>
  )
}
