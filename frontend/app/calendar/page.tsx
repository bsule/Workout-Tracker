"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Sparkles } from "lucide-react"
import {
  getCalendarQ,
  getDayNoteQ,
  getPlannedDatesQ,
  getWorkoutByDateQ,
  setDayNote,
  useHydrated,
  useStore,
} from "@/lib/store"
import { labelForDate } from "@lift/core/format"
import { useAuth } from "@/components/auth/AuthProvider"
import { CalendarMonth } from "@/components/calendar/CalendarMonth"
import { DayWorkoutContent } from "@/components/day/DayWorkoutContent"
import { ignorePageShortcut } from "@/components/day/keyboard"
import { NotePreview } from "@/components/workouts/NotePreview"
import { NoteSheet } from "@/components/ui/NoteSheet"
import { FullPageLoader } from "@/components/ui/Spinner"
import { activeDateOrToday, setActiveDate } from "@/lib/activeDate"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default function CalendarPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <CalendarGate />
    </Suspense>
  )
}

function CalendarGate() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [user, loading, router])

  if (loading || !user) return <FullPageLoader />
  return <CalendarInner />
}

/** The long date over the day detail: "Monday, May 6", never a year. */
function niceLongDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

/**
 * The calendar, the web copy of mobile's CalendarScreen. A click selects a
 * day and shows it under the grid; "Go to date" opens it in the day view.
 * `?date=YYYY-MM-DD` opens that month with that day selected, otherwise the
 * active date (the day last viewed) is selected.
 */
function CalendarInner() {
  const router = useRouter()
  const params = useSearchParams()
  const paramDate = params.get("date")
  const incoming = paramDate && DATE_RE.test(paramDate) ? paramDate : null

  // Mounted only on the client (behind the auth gate), so reading
  // sessionStorage in the initialisers cannot mismatch a server render.
  const [selectedDate, setSelectedDate] = useState(
    () => incoming ?? activeDateOrToday()
  )
  const [view, setView] = useState(() => ({
    year: Number(selectedDate.slice(0, 4)),
    month: Number(selectedDate.slice(5, 7)),
  }))
  const { year, month } = view

  // A new ?date= while the page is open (e.g. "Open calendar" again) jumps
  // the grid there. Adjusting state during render, keyed on the param.
  const [appliedParam, setAppliedParam] = useState(incoming)
  if (incoming !== appliedParam) {
    setAppliedParam(incoming)
    if (incoming) {
      setSelectedDate(incoming)
      setView({
        year: Number(incoming.slice(0, 4)),
        month: Number(incoming.slice(5, 7)),
      })
    }
  }

  useEffect(() => {
    if (incoming) setActiveDate(incoming)
  }, [incoming])

  const hydrated = useHydrated()
  const snapshot = useStore((s) => s.snapshot)
  const data = useMemo(
    () => (hydrated ? getCalendarQ(year, month) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, snapshot, year, month]
  )
  const plannedDates = useMemo(
    () => (hydrated ? getPlannedDatesQ(year, month) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, snapshot, year, month]
  )
  const selectedGym = useMemo(
    () =>
      hydrated ? getWorkoutByDateQ(selectedDate)?.gym?.trim() || null : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, snapshot, selectedDate]
  )
  const selectedNote = useMemo(
    () => (hydrated ? getDayNoteQ(selectedDate) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is the re-run trigger
    [hydrated, snapshot, selectedDate]
  )

  const shiftMonth = useCallback((delta: number) => {
    setView(({ year: y, month: m }) => {
      const idx = y * 12 + (m - 1) + delta
      return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
    })
  }, [])

  function goThisMonth() {
    const now = new Date()
    setView({ year: now.getFullYear(), month: now.getMonth() + 1 })
  }

  function selectDay(date: string) {
    setSelectedDate(date)
    setActiveDate(date)
  }

  // Day note popup: opens read-only, the note is what you came to read.
  // Tied to the date it was opened on, so picking another day drops it.
  const [note, setNote] = useState({
    date: selectedDate,
    open: false,
    mode: "view" as "view" | "edit",
    draft: "",
    original: "",
  })
  const noteOpen = note.open && note.date === selectedDate
  function openNoteViewer() {
    const n = getDayNoteQ(selectedDate)
    setNote({ date: selectedDate, open: true, mode: "view", draft: n, original: n })
  }

  // PageUp / PageDown, and Left / Right when not typing, change the month.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (ignorePageShortcut(e)) return
      if (e.key === "PageUp" || e.key === "ArrowLeft") {
        e.preventDefault()
        shiftMonth(-1)
      } else if (e.key === "PageDown" || e.key === "ArrowRight") {
        e.preventDefault()
        shiftMonth(1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [shiftMonth])

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-6">
      <CalendarMonth
        year={year}
        month={month}
        data={data}
        plannedDates={plannedDates}
        selectedDate={selectedDate}
        onSelect={selectDay}
        onPrev={() => shiftMonth(-1)}
        onNext={() => shiftMonth(1)}
        onToday={goThisMonth}
      />

      <div className="flex flex-col gap-3 pt-4 pb-16">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="text-base font-bold">{niceLongDate(selectedDate)}</h2>
            {selectedGym && (
              <p className="truncate text-sm text-muted-foreground">
                📍 {selectedGym}
              </p>
            )}
            {!!selectedNote.trim() && (
              <button
                type="button"
                onClick={openNoteViewer}
                className="min-w-0 py-px text-left transition-opacity hover:opacity-70 active:opacity-55"
                aria-label="Day note"
              >
                <NotePreview
                  note={selectedNote}
                  className="text-sm italic text-muted-foreground"
                />
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Mobile has this entry point switched off; web keeps it. */}
            <Link
              href={`/ai-plan?startDate=${selectedDate}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-foreground/[.04] px-3 py-1.5 text-xs font-bold transition-colors hover:bg-foreground/10"
            >
              <Sparkles className="size-3.5" />
              AI Plan
            </Link>
            <button
              type="button"
              onClick={() => {
                setActiveDate(selectedDate)
                router.push(`/workouts/date/${selectedDate}`)
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-foreground/[.04] px-3 py-1.5 text-xs font-bold transition-colors hover:bg-foreground/10"
              aria-label={`Go to ${labelForDate(selectedDate)}`}
            >
              Go to date
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>

        <DayWorkoutContent date={selectedDate} />
      </div>

      <NoteSheet
        open={noteOpen}
        mode={note.mode}
        title="Day notes"
        placeholder="How did today go?"
        original={note.original}
        draft={note.draft}
        onChangeDraft={(draft) => setNote((s) => ({ ...s, draft }))}
        onEdit={() => setNote((s) => ({ ...s, mode: "edit" }))}
        onClose={() => setNote((s) => ({ ...s, open: false }))}
        onSave={() => setDayNote(note.date, note.draft.trim())}
      />
    </div>
  )
}
