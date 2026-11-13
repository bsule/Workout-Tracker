import { Alert } from "react-native"

// One alert at a time: a run of failed writes (the engine closed, the disk is
// full) would otherwise stack an alert per tap.
let showing = false

/** Tell the user a change did not save. */
export function reportWriteError(error: unknown, title = "Couldn't save") {
  if (showing) return
  showing = true
  const message =
    error instanceof Error && error.message ? error.message : "Something went wrong. Try again."
  Alert.alert(title, message, [{ text: "OK", onPress: () => { showing = false } }], {
    onDismiss: () => {
      showing = false
    },
  })
}

/** Run a write without waiting on it, and report it if it fails. */
export function guardWrite<T>(write: Promise<T>, title?: string): Promise<T | undefined> {
  return write.catch((error: unknown) => {
    reportWriteError(error, title)
    return undefined
  })
}
