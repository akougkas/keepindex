import { memo } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'
import { useSessionStore } from '@/stores/session-store'

export const ErrorBanner = memo(function ErrorBanner() {
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)
  const sessionConflict = useSessionStore((s) => s.sessionConflict)
  const clearSessionConflict = useSessionStore((s) => s.clearSessionConflict)
  const message = error ?? sessionConflict

  if (!message) return null

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3"
      role="alert"
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5" />
      <p className="flex-1 text-sm text-foreground">{message}</p>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={error ? clearError : clearSessionConflict}
        className="shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss error"
      >
        <X className="size-4" />
      </Button>
    </div>
  )
})
