import { Text, View, type StyleProp, type TextStyle } from "react-native"

const MAX_LINES = 2

/**
 * First two newline-separated lines of a note, each capped to one visual line.
 *
 * `numberOfLines` counts VISUAL lines, after wrapping. On a note whose first
 * line is long, that line wraps to two and swallows the whole budget, so the
 * text gets cut mid-sentence and the user's second line never appears. Here a
 * line means what the user typed: each one gets its own Text with
 * numberOfLines={1}, so it truncates at its own end and never steals the next
 * line's slot.
 *
 * Blank lines are dropped rather than spending a slot on nothing.
 */
export function NotePreview({
  note,
  style,
}: {
  note: string
  style?: StyleProp<TextStyle>
}) {
  const lines = note
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return null

  const shown = lines.slice(0, MAX_LINES)
  const more = lines.length > MAX_LINES

  return (
    <View>
      {shown.map((line, i) => (
        <Text
          key={i}
          style={style}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {more && i === shown.length - 1 ? `${line} …` : line}
        </Text>
      ))}
    </View>
  )
}
