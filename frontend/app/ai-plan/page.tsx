import { redirect } from "next/navigation"

// AI planning is disabled to match the mobile app.
export default function DisabledAiPage() {
  redirect("/calendar")
}
