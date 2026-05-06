import Link from "next/link"
import { ArrowRight, TrendingUp, BarChart3, Target, Dumbbell, Flame, Timer } from "lucide-react"
import { PageWrapper } from "@/components/layout/PageWrapper"

const features = [
  {
    n: "01",
    icon: TrendingUp,
    label: "Track PRs",
    description:
      "Log every set, rep, and weight. Watch your one-rep max climb week over week.",
  },
  {
    n: "02",
    icon: BarChart3,
    label: "See Progress",
    description:
      "Live charts of your last seven sessions, plotted per exercise. No fluff.",
  },
  {
    n: "03",
    icon: Target,
    label: "Stay Consistent",
    description:
      "Build splits, log sessions by day, and never lose a single working set.",
  },
]

export default function HomePage() {
  return (
    <PageWrapper>
      {/* Hero */}
      <section className="relative h-[calc(100vh-3.5rem)] overflow-hidden border-b-2 border-white/15">
        {/* Diagonal accent stripe */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, transparent 0 80px, oklch(1 0 0) 80px 82px)",
          }}
        />
        {/* Subtle grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1 0 0) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center px-6">
          {/* Eyebrow */}
          <div className="mb-8 flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.25em] text-primary">
            <span className="inline-block h-px w-8 bg-primary" />
            <span>// Workout Tracker · v1</span>
          </div>

          {/* Display headline */}
          <h1 className="font-display text-[clamp(3rem,10vw,9rem)] leading-[0.88] tracking-tight text-foreground uppercase">
            Lift Heavy.
            <br />
            <span className="text-primary">Track Heavier.</span>
          </h1>

          {/* Lede */}
          <p className="mt-8 max-w-2xl text-lg font-medium text-muted-foreground sm:text-xl">
            The no-nonsense workout tracker for lifters who actually count their
            sets. Log it, chart it, smash it.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/workouts"
              className="group inline-flex h-14 items-center gap-3 rounded-none border-2 border-primary bg-primary px-8 font-display text-base uppercase tracking-wider text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[8px_8px_0_0_oklch(1_0_0_/_15%)]"
            >
              Start Logging
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>

        </div>
      </section>

      {/* Feature blocks */}
      <section className="border-b-2 border-white/15 bg-background px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.25em] text-secondary">
                // What it does
              </div>
              <h2 className="font-display text-5xl uppercase leading-[0.95] tracking-tight text-foreground sm:text-6xl">
                Built for the
                <br />
                <span className="text-secondary">working set.</span>
              </h2>
            </div>
            <p className="max-w-sm text-base text-muted-foreground">
              Three things, done right. No social feed. No premium tier. Just
              the data you actually open the app for.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-0 border-2 border-white/15 md:grid-cols-3">
            {features.map(({ n, icon: Icon, label, description }, i) => (
              <div
                key={label}
                className={`group relative bg-card p-8 transition-colors hover:bg-card/60 ${
                  i < 2 ? "md:border-r-2 md:border-white/15" : ""
                } ${i > 0 ? "border-t-2 border-white/15 md:border-t-0" : ""}`}
              >
                <div className="mb-8 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold uppercase tracking-[0.25em] text-muted-foreground">
                    {n}
                  </span>
                  <div className="flex size-12 items-center justify-center border-2 border-primary/40 bg-primary/10 transition-colors group-hover:border-primary group-hover:bg-primary/20">
                    <Icon className="size-5 text-primary" />
                  </div>
                </div>
                <h3 className="mb-3 font-display text-2xl uppercase tracking-tight text-foreground">
                  {label}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Auto-scrolling marquee */}
      <section
        aria-hidden="true"
        className="relative overflow-hidden border-y-2 border-primary bg-primary py-5 text-primary-foreground"
      >
        <div className="flex w-max animate-marquee whitespace-nowrap font-display text-2xl uppercase tracking-wider sm:text-3xl">
          {Array.from({ length: 2 }).map((_, dup) => (
            <div key={dup} className="flex shrink-0 items-center">
              {[
                "Stay Hard",
                "Train Hard",
                "Lift Heavy",
                "Track Every Rep",
                "Own Every PR",
                "No Excuses",
              ].map((phrase, i) => (
                <span key={`${dup}-${i}`} className="flex shrink-0 items-center">
                  <span className="px-8">{phrase}</span>
                  <span className="px-2 text-primary-foreground/60">/</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Big call-to-action band */}
      <section className="relative overflow-hidden bg-primary text-primary-foreground">
        <div
          className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 24px, oklch(0 0 0) 24px 25px)",
          }}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col items-start justify-between gap-10 px-6 py-20 md:flex-row md:items-center">
          <div>
            <div className="mb-4 flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.25em] text-primary-foreground/70">
              <Flame className="size-3.5" />
              <span>// No excuses</span>
            </div>
            <h2 className="font-display text-5xl uppercase leading-[0.95] tracking-tight sm:text-6xl">
              Your next PR
              <br />
              starts on Monday.
            </h2>
          </div>
          <Link
            href="/signup"
            className="group inline-flex h-16 items-center gap-4 border-2 border-primary-foreground bg-background px-10 font-display text-lg uppercase tracking-wider text-foreground transition-all hover:bg-foreground hover:text-background"
          >
            Create Account
            <ArrowRight className="size-6 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* Footer marquee strip */}
      <section className="overflow-hidden border-t-2 border-white/15 bg-background py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          <span className="flex items-center gap-2">
            <Dumbbell className="size-3.5" /> Squat · Bench · Deadlift
          </span>
          <span className="flex items-center gap-2">
            <Timer className="size-3.5" /> Rest timer
          </span>
          <span className="flex items-center gap-2">
            <TrendingUp className="size-3.5" /> 1RM tracking
          </span>
          <span className="text-primary">// LIFT</span>
        </div>
      </section>
    </PageWrapper>
  )
}
