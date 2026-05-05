"use client"

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"
import { DayView } from "@/components/workouts/DayView"
import { useAuth } from "@/components/auth/AuthProvider"

export default function DayPage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = use(params)
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  if (loading || !user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <DayView date={date} />
    </div>
  )
}
