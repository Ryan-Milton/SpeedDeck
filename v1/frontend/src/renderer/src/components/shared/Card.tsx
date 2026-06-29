import { cn } from '../../lib/utils'

const PADDING = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5'
} as const

export function Card({
  children,
  className,
  padding = 'md',
  onClick
}: {
  children: React.ReactNode
  className?: string
  padding?: 'sm' | 'md' | 'lg'
  onClick?: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-2xl bg-surface-card',
        PADDING[padding],
        onClick && 'cursor-pointer active:bg-surface-active transition-colors',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
