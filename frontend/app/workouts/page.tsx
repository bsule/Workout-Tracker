"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { activeDateOrToday } from "@/lib/activeDate"
import { useAuth } from "@/components/auth/AuthProvider"
import { FullPageLoader } from "@/components/ui/Spinner"

export default function WorkoutsIndex() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/login")
      return
    }
    // The day last viewed in this tab (mobile keeps it in ActiveDate), or today.
    router.replace(`/workouts/date/${activeDateOrToday()}`)
  }, [user, loading, router])

  return <FullPageLoader />
}
