import { Pressable, StyleSheet, Text, View } from "react-native"
import { theme } from "../theme/theme"
import { useCategoryStyles } from "../categories/CategoryStylesProvider"

/**
 * A wrapping grid of category chips, each with its colour dot. Used to pick an
 * exercise's category and to filter the exercise picker by one. `padded` adds
 * the inset the picker screens use around the grid.
 */
export function CategoryChips({
  selected,
  onSelect,
  padded = false,
}: {
  selected: string | null
  onSelect: (cat: string) => void
  padded?: boolean
}) {
  const { categories, labels, colors: catColors } = useCategoryStyles()
  return (
    <View style={[styles.chipsGrid, padded && styles.padded]}>
      {categories.map((cat) => {
        const active = selected === cat
        const dot = catColors[cat] ?? theme.colors.cat[cat] ?? theme.colors.muted
        return (
          <Pressable
            key={cat}
            onPress={() => onSelect(cat)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <View style={[styles.chipDot, { backgroundColor: dot }]} />
            <Text style={styles.chipText}>{labels[cat] ?? cat}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  padded: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  chip: {
    flexBasis: "23%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipActive: { backgroundColor: theme.colors.cardElevated, borderColor: theme.colors.foreground },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
})
