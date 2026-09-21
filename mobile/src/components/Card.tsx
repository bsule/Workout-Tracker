import { StyleSheet, View, type ViewProps } from "react-native"
import { theme } from "../theme/theme"

export function Card({ style, children, ...rest }: ViewProps) {
  return (
    <View {...rest} style={[cardStyle, style]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
})

/** The card look, for a pressable or other non-View that wants it. */
export const cardStyle = styles.card
