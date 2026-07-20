import { cn } from '@/lib/utils/cn'

// Marca MacrAI: la M trazada como gráfico ascendente, centrada en el cuadrado.
// El path vive en un viewBox 0 0 100 100 con bounding box simétrico (x 27-73, y 29-71).

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="26" className="fill-primary" />
      <path
        d="M27 71 L27 33 L50 55 L73 29 L73 71"
        className="stroke-primary-foreground"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export function Logo({
  size = 32,
  showWordmark = true,
  className,
}: {
  size?: number
  showWordmark?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      {showWordmark && (
        <span
          className="font-head font-bold tracking-tight leading-none"
          style={{ fontSize: size * 0.62 }}
        >
          Macr<span className="text-primary">AI</span>
        </span>
      )}
    </div>
  )
}
