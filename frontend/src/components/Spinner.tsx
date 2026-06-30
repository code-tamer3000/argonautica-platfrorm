export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-label="Загрузка"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: '2px solid var(--color-frame-deep)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'arg-spin 0.8s linear infinite',
      }}
    />
  )
}
