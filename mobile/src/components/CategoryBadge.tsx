import { StyleSheet, Text, View } from "react-native"
import { theme } from "../theme/theme"
import {
  useCategoryColor,
  useCategoryLabel,
} from "../categories/CategoryStylesProvider"

export function CategoryBadge({ slug }: { slug: string }) {
  const color = useCategoryColor(slug)
  const label = useCategoryLabel(slug)
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.label}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
  },
})
