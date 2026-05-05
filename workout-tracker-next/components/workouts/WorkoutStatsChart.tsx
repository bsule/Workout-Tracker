"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

interface ChartPoint {
  date: string
  maxWeight: number
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-primary">
        {Math.round(payload[0].value)} lbs
      </p>
    </div>
  )
}

export function WorkoutStatsChart({ data }: { data: ChartPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-white/3 text-sm text-muted-foreground">
        Not enough sessions to show a chart yet.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "oklch(0.64 0 0)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "oklch(0.64 0 0)" }}
          axisLine={false}
          tickLine={false}
          domain={["auto", "auto"]}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="maxWeight"
          stroke="oklch(0.61 0.20 260)"
          strokeWidth={2}
          dot={{ r: 4, fill: "oklch(0.61 0.20 260)", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "oklch(0.61 0.20 260)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
