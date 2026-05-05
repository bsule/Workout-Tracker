"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { todayLocal } from "@/lib/utils"
import { useAuth } from "@/components/auth/AuthProvider"

export default function WorkoutsIndex() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/login")
      return
    }
    router.replace(`/workouts/date/${todayLocal()}`)
  }, [user, loading, router])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-muted-foreground">
      Loading…
    </div>
  )
}
