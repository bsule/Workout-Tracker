import { Text, View, StyleSheet } from "react-native"
import { theme } from "../theme/theme"

export function PrIcon({ historical }: { historical?: boolean }) {
  return (
    <View style={[styles.badge, historical && styles.historical]}>
      <Text style={styles.text} numberOfLines={1} allowFontScaling={false}>
        PR
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
  text: {
    fontSize: 9,
    fontWeight: "800",
    color: "#1a1a1a",
    letterSpacing: 0.5,
  },
})
