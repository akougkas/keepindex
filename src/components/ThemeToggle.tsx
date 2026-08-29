import { useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/theme-store'
import { cn } from '@/lib/utils'

export function ThemeToggle() {
  const isDark = useThemeStore((s) => s.isDark)
  const toggleTheme = useThemeStore((s) => s.toggleTheme)
  const init = useThemeStore((s) => s.init)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [isDark])

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'size-9 rounded-full transition-colors',
        'hover:bg-muted/80'
      )}
    >
      {isDark ? (
        <Sun className="size-4 text-muted-foreground hover:text-foreground" />
      ) : (
        <Moon className="size-4 text-muted-foreground hover:text-foreground" />
      )}
    </Button>
  )
}
