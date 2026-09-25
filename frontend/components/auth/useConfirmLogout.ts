"use client"

import { useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth/AuthProvider"
import { useConfirm } from "@/components/ui/ConfirmDialog"

/** Asks "Log out?" first, the same prompt as mobile's Settings screen, then
 *  logs out and goes to the login page. */
export function useConfirmLogout(): () => Promise<void> {
  const { logout } = useAuth()
  const confirm = useConfirm()
  const router = useRouter()
  return useCallback(async () => {
    const ok = await confirm({
      title: "Log out?",
      message: "You can log back in at any time.",
      confirmLabel: "Log out",
      destructive: true,
    })
    if (!ok) return
    await logout()
    router.push("/login")
  }, [confirm, logout, router])
}
