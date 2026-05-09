import { View, type ViewProps, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { theme } from "../theme/theme"

interface Props extends ViewProps {
  style?: ViewStyle | ViewStyle[]
}

export function StaticSafeAreaView({ style, ...props }: Props) {
  const insets = useSafeAreaInsets()
  return (
    <View
      {...props}
      style={[
        {
          flex: 1,
          paddingTop: insets.top,
          backgroundColor: theme.colors.background,
        },
        style,
      ]}
    />
  )
}
