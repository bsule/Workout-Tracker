"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { api } from "@/lib/api"
import { useAuth } from "@/components/auth/AuthProvider"
import { CATEGORIES, type Category } from "@/types"
import { CATEGORY_LABELS, categoryVar, cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export default function NewExercisePage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [name, setName] = useState("")
  const [category, setCategory] = useState<Category>("chest")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError("Name is required.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createExercise({ name: name.trim(), category })
      router.push("/exercises")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create")
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:py-10 space-y-6">
      <Link
        href="/exercises"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronLeft className="size-4" />
        Exercises
      </Link>

      <h1 className="text-xl font-bold tracking-tight">New Exercise</h1>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="text-sm font-medium">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/[.02] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            autoFocus
          />
        </div>

        <div>
          <label className="text-sm font-medium">Category</label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CATEGORIES.map((c) => {
              const active = c === category
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium",
                    active
                      ? "border-white/30 bg-white/10 text-foreground"
                      : "border-white/10 bg-white/[.02] hover:bg-white/5"
                  )}
                >
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: categoryVar(c) }}
                  />
                  {CATEGORY_LABELS[c]}
                </button>
              )
            })}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? "Creating…" : "Create"}
        </Button>
      </form>
    </div>
  )
}
