import Link from "next/link"
import { TrendingUp, BarChart3, Target } from "lucide-react"
import { PageWrapper } from "@/components/layout/PageWrapper"

const stats = [
  {
    icon: TrendingUp,
    label: "Track PRs",
    description: "Log every set and watch your one-rep max climb week over week.",
  },
  {
    icon: BarChart3,
    label: "View Charts",
    description: "Visualise your last 7 sessions with a live progress chart per exercise.",
  },
  {
    icon: Target,
    label: "Stay Consistent",
    description: "Build split routines, log sessions by day, and never lose your data.",
  },
]

export default function HomePage() {
  return (
    <PageWrapper>
      {/* Hero */}
      <section
        className="relative flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center px-4 text-center"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.61 0.20 260 / 18%), transparent)",
        }}
      >
        {/* Subtle grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative z-10 max-w-3xl">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Workout Tracker
          </p>
          <h1 className="mb-6 text-5xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-6xl md:text-7xl">
            Track Every Rep.
            <br />
            <span className="text-primary">Own Every PR.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-xl text-lg text-muted-foreground sm:text-xl">
            The clean workout tracker built for lifters who care about progress.
            Log sets, view charts, and hit new PRs.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/workouts"
              className="inline-flex h-11 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/80 transition-all"
            >
              Get Started
            </Link>
            <Link
              href="/calculator"
              className="inline-flex h-11 items-center rounded-lg border border-white/10 bg-white/5 px-6 text-sm font-medium text-foreground hover:bg-white/8 transition-colors"
            >
              Try Calculator
            </Link>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="border-t border-white/8 bg-card/40 px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map(({ icon: Icon, label, description }) => (
              <div
                key={label}
                className="rounded-xl border border-white/8 bg-card p-6 transition-all hover:border-white/15 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="size-5 text-primary" />
                </div>
                <h3 className="mb-1 font-semibold text-foreground">{label}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PageWrapper>
  )
}
