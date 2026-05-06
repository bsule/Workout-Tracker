"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { todayLocal } from "@/lib/utils"
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
    router.replace(`/workouts/date/${todayLocal()}`)
  }, [user, loading, router])

  return <FullPageLoader />
}
