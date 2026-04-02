import { cn } from '../../lib/utils'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  if (!open) return <></>

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-surface-card rounded-3xl p-6 w-80 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        <p className="text-sm text-text-secondary">{message}</p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 h-12 rounded-2xl text-sm font-semibold bg-surface-active text-text-primary active:bg-surface transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'flex-1 h-12 rounded-2xl text-sm font-semibold transition-colors',
              variant === 'danger'
                ? 'bg-danger text-white active:bg-danger/80'
                : 'bg-accent text-white active:bg-accent/80'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
