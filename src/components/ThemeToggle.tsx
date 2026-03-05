'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function ThemeToggle() {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
  const { theme, resolvedTheme, setTheme } = useTheme()
  const activeTheme = mounted ? (resolvedTheme ?? theme) : null

  if (!activeTheme) {
    return (
      <button
        className="p-2 rounded-md border"
        aria-label="Toggle theme"
        aria-hidden="true"
        disabled
      >
        <span className="block h-4 w-4" />
      </button>
    )
  }

  return (
    <button
      onClick={() => setTheme(activeTheme === 'dark' ? 'light' : 'dark')}
      className="p-2 rounded-md border"
      aria-label="Toggle theme"
    >
      {activeTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
