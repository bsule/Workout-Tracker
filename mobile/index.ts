import "react-native-gesture-handler"
// crypto.getRandomValues — sql.js & FitNotes export need it for v4 UUIDs.
import "react-native-get-random-values"
import { registerRootComponent } from "expo"
import App from "./App"

registerRootComponent(App)
