import Constants from "expo-constants"
import { View, type ViewProps, type ViewStyle } from "react-native"
import { initialWindowMetrics } from "react-native-safe-area-context"
import { theme } from "../theme/theme"

const topInset =
  initialWindowMetrics?.insets.top ?? Constants.statusBarHeight ?? 0

interface Props extends ViewProps {
  style?: ViewStyle | ViewStyle[]
}

export function StaticSafeAreaView({ style, ...props }: Props) {
  return (
    <View
      {...props}
      style={[
        {
          flex: 1,
          paddingTop: topInset,
          backgroundColor: theme.colors.background,
        },
        style,
      ]}
    />
  )
}
