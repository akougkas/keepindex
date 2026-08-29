import { Lightbulb } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { cn } from '@/lib/utils'

export function KeyTakeaways() {
  const takeaways = useAppStore((s) => s.takeaways)

  if (takeaways.length === 0) return null

  return (
    <div
      className={cn(
        'rounded-xl p-4 mb-4 border',
        'bg-primary/5 border-primary/20'
      )}
    >
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
        <Lightbulb className="size-4 text-primary" />
        Key Takeaways
      </h3>
      <ul className="space-y-1.5 text-sm font-medium">
        {takeaways.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-primary shrink-0">•</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
