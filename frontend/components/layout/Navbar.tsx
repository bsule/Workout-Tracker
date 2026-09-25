"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useIsClient } from "@/lib/useIsClient"
import { Dumbbell, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth/AuthProvider"
import { useConfirmLogout } from "@/components/auth/useConfirmLogout"

// Same names and order as the mobile tab bar.
const navLinks = [
  { href: "/workouts", label: "Today" },
  { href: "/exercises", label: "Exercises" },
  { href: "/calendar", label: "Calendar" },
]

export function Navbar() {
  const pathname = usePathname()
  const { user, loading } = useAuth()
  const confirmLogout = useConfirmLogout()
  const mounted = useIsClient()
  // Signed out, every app page redirects to login, so its links lead nowhere.
  // They stay up until auth has loaded, so a signed-in page does not flash
  // without them.
  const signedOut = mounted && !loading && !user
  const hideNavLinks =
    signedOut || pathname === "/" || pathname === "/login" || pathname === "/signup"

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/workouts"
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
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
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
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                title="Settings"
              >
                <Settings className="size-4" />
                <span className="hidden sm:inline">{user.username}</span>
              </Link>
              <button
                onClick={() => void confirmLogout()}
                className="inline-flex rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden sm:inline-flex rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
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

      {/* Below sm the links get their own row, so every page stays one tap
          away on a phone. */}
      {!hideNavLinks && (
        <nav className="flex border-t border-border sm:hidden">
          {navLinks.map((link) => {
            const active = pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex-1 py-2 text-center text-sm font-medium transition-colors",
                  active
                    ? "text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>
      )}
    </header>
  )
}
