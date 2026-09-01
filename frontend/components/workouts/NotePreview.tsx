const MAX_LINES = 2

/**
 * First two newline-separated lines of a note, each capped to one visual line.
 *
 * `line-clamp-2` counts VISUAL lines, after wrapping. On a note whose first
 * line is long, that line wraps to two and swallows the whole budget, so the
 * text gets cut mid-sentence and the user's second line never appears. Here a
 * line means what the user typed: each one is its own truncating block, so it
 * ends at its own edge and never steals the next line's slot.
 *
 * Blank lines are dropped rather than spending a slot on nothing.
 */
export function NotePreview({
  note,
  className,
}: {
  note: string
  className?: string
}) {
  const lines = note
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return null

  const shown = lines.slice(0, MAX_LINES)
  const more = lines.length > MAX_LINES

  return (
    <span className="block min-w-0">
      {shown.map((line, i) => (
        <span key={i} className={`block truncate ${className ?? ""}`}>
          {more && i === shown.length - 1 ? `${line} …` : line}
        </span>
      ))}
    </span>
  )
}
