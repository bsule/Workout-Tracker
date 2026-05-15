"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { localApi as api, getPlannedDatesQ } from "@/lib/store"
import { useAuth } from "@/components/auth/AuthProvider"
import { CalendarMonth } from "@/components/calendar/CalendarMonth"
import { FullPageLoader } from "@/components/ui/Spinner"
import type { CalendarMap } from "@/types"

export default function CalendarPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1) // 1..12
  const [data, setData] = useState<CalendarMap>({})
  const [plannedDates, setPlannedDates] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  useEffect(() => {
    if (!user) return
    api
      .getCalendar(year, month)
      .then((d) => {
        setData(d)
        setPlannedDates(getPlannedDatesQ(year, month))
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load calendar")
      )
  }, [user, year, month])

  function shift(delta: number) {
    let m = month + delta
    let y = year
    while (m < 1) {
      m += 12
      y -= 1
    }
    while (m > 12) {
      m -= 12
      y += 1
    }
    setMonth(m)
    setYear(y)
  }

  if (loading || !user) {
    return <FullPageLoader />
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Calendar</h1>
        <Link
          href="/ai-plan"
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/20"
        >
          <Sparkles className="size-3.5" />
          AI Plan
        </Link>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <CalendarMonth
        year={year}
        month={month}
        data={data}
        plannedDates={plannedDates}
        onPrev={() => shift(-1)}
        onNext={() => shift(1)}
      />
    </div>
  )
}
