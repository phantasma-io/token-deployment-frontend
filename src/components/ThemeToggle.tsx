"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const theme = saved ?? (prefersDark ? "dark" : "light");
    root.classList.toggle("dark", theme === "dark");
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const toggle = () => {
    const root = document.documentElement;
    const isDark = root.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
  };

  return (
    <button
      aria-label="Toggle theme"
      onClick={toggle}
      className="fixed top-2 right-2 z-50 rounded-md border px-2 py-1 text-sm
                 bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <span className="block dark:hidden">🌙</span>
      <span className="hidden dark:block">☀️</span>
    </button>
  );
}
