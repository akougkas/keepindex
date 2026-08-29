import type { ReactNode } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

interface PanelShellProps {
  title: string
  children?: ReactNode
  className?: string
  headerActions?: ReactNode
  metadataBar?: ReactNode
  dataPanel?: string
}

export function PanelShell({
  title,
  children,
  className,
  headerActions,
  metadataBar,
  dataPanel,
}: PanelShellProps) {
  const isLoading = useAppStore((s) => s.isLoading)

  return (
    <Card
      className={cn(
      'h-full overflow-auto backdrop-blur-sm bg-card/90 border-border/50 shadow-sm rounded-xl',
      className
    )}
      {...(dataPanel ? { 'data-panel': dataPanel } : {})}
    >
      <CardHeader className="border-b border-border/50 pb-3">
        <CardTitle className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
        {headerActions && <CardAction>{headerActions}</CardAction>}
      </CardHeader>
      {metadataBar && (
        <div className="px-6 pb-2 border-b border-border/30">{metadataBar}</div>
      )}
      <CardContent>
        {children ?? (
          isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Submit a query to see results here.
            </p>
          )
        )}
      </CardContent>
    </Card>
  )
}
