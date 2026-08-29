import { RotateCcw, FlaskConical } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useAppStore, type Mode } from '@/stores/app-store'
import { switchModeWithJourney } from '@/lib/mode-switch'
import { cn } from '@/lib/utils'

export function ModeSelector() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const chatMessages = useAppStore((s) => s.chatMessages)
  const clearChat = useAppStore((s) => s.clearChat)
  const modeJustSwitched = useAppStore((s) => s.modeJustSwitched)

  const handleModeChange = (next: string) => {
    const nextMode = next as Mode
    switchModeWithJourney(nextMode, 'mode_selector', setMode)
  }

  return (
    <div className="flex justify-center items-center gap-2 w-full overflow-x-auto">
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="backdrop-blur-sm bg-muted/60 border border-border/60 shadow-sm">
          <TabsTrigger
            value="search"
            className={cn(modeJustSwitched === 'search' && 'animate-pulse')}
          >
            Search
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className={cn(modeJustSwitched === 'ai' && 'animate-pulse')}
          >
            AI Answer
          </TabsTrigger>
          <TabsTrigger
            value="chat"
            className={cn(modeJustSwitched === 'chat' && 'animate-pulse')}
          >
            Chat
          </TabsTrigger>
          <TabsTrigger
            value="research"
            className={cn(modeJustSwitched === 'research' && 'animate-pulse')}
          >
            <FlaskConical className="size-3.5 mr-1.5" />
            Deep Research
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'chat' && chatMessages.length > 0 && (
        <Button variant="ghost" size="icon" onClick={clearChat} title="New Chat">
          <RotateCcw className="size-4" />
        </Button>
      )}
    </div>
  )
}
