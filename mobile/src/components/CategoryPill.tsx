import { StyleSheet, Text, View } from "react-native"
import {
  useCategoryColor,
  useCategoryLabel,
} from "../categories/CategoryStylesProvider"
import { theme } from "../theme/theme"

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(255,255,255,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export function CategoryPill({ slug }: { slug: string }) {
  const color = useCategoryColor(slug)
  const label = useCategoryLabel(slug)
  return (
    <View style={[styles.pill, { borderColor: withAlpha(color, 0.55) }]}>
      <Text style={[styles.label, { color: withAlpha(color, 0.85) }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  label: {
    fontFamily: theme.font.body,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
})
