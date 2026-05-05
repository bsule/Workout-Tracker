"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { WorkoutStatsChart } from "./WorkoutStatsChart"

interface ChartPoint {
  date: string
  maxWeight: number
}

export function ChartToggle({ data }: { data: ChartPoint[] }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-xl border border-white/8 bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/3"
      >
        <span className="text-sm font-semibold text-foreground">
          Progress Chart
        </span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="size-4 text-muted-foreground" />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="chart"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/8 px-5 py-4">
              <WorkoutStatsChart data={data} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
