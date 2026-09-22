import { useState } from "react"
import { LayoutAnimation, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { localApi as api } from "@lift/core"
import { DUR, EXPAND_ANIM, deferPastAnimation } from "../../anim"
import { Button } from "../../components/Button"
import { PopupModal } from "../../components/PopupModal"
import {
  SettingsFooter,
  SettingsGroup,
  SwitchRow,
  ValueRow,
} from "../../components/SettingRows"
import {
  CUTOFF_MAX_S,
  CUTOFF_MIN_S,
  formatCutoff,
  parseCutoff,
  restTimer,
} from "../../restTimer"
import { useSettings } from "../../settings/SettingsProvider"
import { theme } from "../../theme/theme"
import { settingsPageStyles } from "./GeneralSettingsScreen"

export function RestTimerSettingsScreen() {
  const { restTimerEnabled, restTimerCutoffS } = useSettings()

  function setEnabled(on: boolean) {
    if (on === restTimerEnabled) return
    // The cutoff row appears or goes away under the switch.
    LayoutAnimation.configureNext(EXPAND_ANIM)
    api.updateSettings({ rest_timer_activity: on })
    if (on) restTimer.enable()
    else restTimer.disable()
  }

  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  function openEditor() {
    setDraft(formatCutoff(restTimerCutoffS))
    setError(null)
    setEditorOpen(true)
  }
  function save() {
    const secs = parseCutoff(draft)
    if (secs == null) {
      setError("Enter minutes, like 6, or minutes and seconds, like 6:30.")
      return
    }
    if (secs < CUTOFF_MIN_S || secs > CUTOFF_MAX_S) {
      setError(`Enter a time from ${formatCutoff(CUTOFF_MIN_S)} to ${formatCutoff(CUTOFF_MAX_S)}.`)
      return
    }
    setEditorOpen(false)
    // The store commit re-renders every settings consumer; let the popup
    // fade out first.
    if (secs !== restTimerCutoffS) {
      deferPastAnimation(() => api.updateSettings({ rest_timer_cutoff_s: secs }), DUR.fade)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={settingsPageStyles.wrap}>
        <SettingsGroup>
          <SwitchRow
            label="Rest timer outside the app"
            value={restTimerEnabled}
            onChange={setEnabled}
          />
          {restTimerEnabled && (
            <ValueRow
              label="Hide timer after"
              value={formatCutoff(restTimerCutoffS)}
              onPress={openEditor}
            />
          )}
        </SettingsGroup>
        <SettingsFooter>
          {Platform.OS === "ios"
            ? "After each set, the time since that set shows in the Dynamic Island and on the Lock Screen."
            : "After each set, the time since that set shows in a notification."}
          {restTimerEnabled
            ? " It goes away at the time above, when you are likely done."
            : ""}
        </SettingsFooter>
      </ScrollView>

      <PopupModal visible={editorOpen} title="Hide timer after" onClose={() => setEditorOpen(false)}>
        <TextInput
          value={draft}
          onChangeText={(t) => {
            setDraft(t)
            setError(null)
          }}
          autoFocus
          selectTextOnFocus
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          onSubmitEditing={save}
          placeholder="6:00"
          placeholderTextColor={theme.colors.muted}
          style={styles.input}
        />
        <Text style={styles.help}>
          Minutes, or minutes and seconds. From {formatCutoff(CUTOFF_MIN_S)} to{" "}
          {formatCutoff(CUTOFF_MAX_S)}. Applies from your next set.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => setEditorOpen(false)}
            style={{ flex: 1 }}
          />
          <Button label="Save" onPress={save} disabled={!draft.trim()} style={{ flex: 1 }} />
        </View>
      </PopupModal>
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  help: { color: theme.colors.muted, fontSize: theme.fontSize.xs, lineHeight: 17 },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.xs },
  actions: { flexDirection: "row", gap: theme.spacing[3] },
})
