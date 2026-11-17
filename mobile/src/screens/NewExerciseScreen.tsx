import { SafeAreaView } from "react-native-safe-area-context"
import { usePrepareScreenReturn } from "../store/useScreenSnapshot"
import { NewExerciseView } from "../components/NewExerciseView"
import { theme } from "../theme/theme"

/** The Exercises tab's + : the same New Exercise form the pickers show. */
export function NewExerciseScreen({ navigation, route }: any) {
  const prepareReturn = usePrepareScreenReturn()
  const { initialName, initialCategory } = route.params ?? {}

  function back() {
    prepareReturn()
    navigation.goBack()
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      edges={["top"]}
    >
      <NewExerciseView
        initialName={initialName}
        initialCategory={initialCategory}
        onBack={back}
        onCreated={back}
      />
    </SafeAreaView>
  )
}
