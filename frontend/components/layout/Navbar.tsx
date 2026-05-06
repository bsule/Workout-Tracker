"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Dumbbell, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth/AuthProvider"

const navLinks = [
  { href: "/workouts", label: "Workout" },
  { href: "/calendar", label: "Calendar" },
  { href: "/exercises", label: "Exercises" },
  { href: "/calculator", label: "Calculator" },
]

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, logout } = useAuth()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const hideNavLinks =
    pathname === "/" || pathname === "/login" || pathname === "/signup"

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-black/60 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground hover:opacity-80 transition-opacity"
        >
          <Dumbbell className="size-5 text-primary" />
          LIFT
        </Link>

        {!hideNavLinks && (
          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname.startsWith(link.href)
                    ? "bg-white/8 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2" suppressHydrationWarning>
          {!mounted || loading ? null : user ? (
            <>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                title="Settings"
              >
                <Settings className="size-4" />
                <span className="hidden sm:inline">{user.username}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="inline-flex rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden sm:inline-flex rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/80 transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
