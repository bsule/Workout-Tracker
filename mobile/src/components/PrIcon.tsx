import { Text, View, StyleSheet } from "react-native"
import { theme } from "../theme/theme"

type Variant = "overall" | "position"

export function PrIcon({
  historical,
  variant = "overall",
  position,
}: {
  historical?: boolean
  variant?: Variant
  position?: number
}) {
  const isPosition = variant === "position"
  const label = isPosition && position != null ? `${position}PR` : "PR"
  return (
    <View
      style={[
        styles.badge,
        isPosition && styles.position,
        historical && (isPosition ? styles.positionHistorical : styles.historical),
      ]}
    >
      <Text
        style={[styles.text, isPosition && styles.positionText]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#e0c050",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: "flex-start",
  },
  historical: { backgroundColor: theme.colors.muted },
  position: {
    backgroundColor: "#4a90e2",
    paddingHorizontal: 3,
    paddingVertical: 0,
  },
  positionHistorical: { backgroundColor: theme.colors.muted },
  text: {
    fontSize: 9,
    fontWeight: "800",
    color: "#1a1a1a",
    letterSpacing: 0.5,
  },
  positionText: { fontSize: 8, color: "#ffffff" },
})
