import { Pressable, StyleSheet, Text, View } from "react-native"
import { isLight, theme, tint } from "../theme/theme"
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
            accessibilityRole="button"
            accessibilityLabel={labels[cat] ?? cat}
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <View style={[styles.chipDot, { backgroundColor: dot }]} />
            <Text
              style={styles.chipText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {labels[cat] ?? cat}
            </Text>
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
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: isLight() ? theme.colors.borderStrong : "transparent",
  },
  chipActive: {
    backgroundColor: isLight() ? tint(0.1) : theme.colors.cardElevated,
    borderColor: theme.colors.foreground,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  chipText: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
  },
})
