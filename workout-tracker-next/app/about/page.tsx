import { GitBranch, Globe, Mail } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PageWrapper } from "@/components/layout/PageWrapper"

const techStack = [
  "Next.js",
  "Django",
  "TypeScript",
  "Python",
  "Tailwind CSS",
  "SQLite",
  "React Hook Form",
  "Recharts",
]

const links = [
  {
    icon: GitBranch,
    label: "GitHub",
    href: "https://github.com/bsule",
    description: "bsule",
  },
  {
    icon: Globe,
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/bilal-suleiman-a1aa741b9/",
    description: "Bilal Suleiman",
  },
  {
    icon: Mail,
    label: "Email",
    href: "mailto:bilal.suleiman@gmail.com",
    description: "bilal.suleiman@gmail.com",
  },
]

export default function AboutPage() {
  return (
    <PageWrapper>
      <div className="mx-auto max-w-2xl px-4 py-20">
        {/* Profile */}
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-primary/60 to-primary text-2xl font-bold text-primary-foreground shadow-lg shadow-primary/20">
            BS
          </div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight text-foreground">
            Bilal Suleiman
          </h1>
          <p className="text-sm font-medium text-muted-foreground">
            Full-Stack Developer
          </p>
        </div>

        {/* Description */}
        <div className="mb-10 rounded-xl border border-white/8 bg-card p-6 text-center">
          <p className="text-muted-foreground leading-relaxed">
            Full-stack personal project built to track real gym progress. The
            backend uses <span className="text-foreground font-medium">Django</span> with a
            REST API, and the frontend is a{" "}
            <span className="text-foreground font-medium">Next.js</span> app with
            live charts, form validation, and a dark gym aesthetic.
          </p>
        </div>

        {/* Tech stack */}
        <div className="mb-10">
          <h2 className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Built With
          </h2>
          <div className="flex flex-wrap justify-center gap-2">
            {techStack.map((tech) => (
              <Badge
                key={tech}
                variant="secondary"
                className="rounded-full px-3 py-1 text-xs font-medium"
              >
                {tech}
              </Badge>
            ))}
          </div>
        </div>

        {/* Links */}
        <div className="grid gap-3 sm:grid-cols-3">
          {links.map(({ icon: Icon, label, href, description }) => (
            <a
              key={label}
              href={href}
              target={href.startsWith("mailto") ? undefined : "_blank"}
              rel="noopener noreferrer"
              className="group flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-card p-5 text-center transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 transition-colors group-hover:bg-primary/20">
                <Icon className="size-5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </a>
          ))}
        </div>
      </div>
    </PageWrapper>
  )
}
