'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
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

  const activeTheme = resolvedTheme ?? theme

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
