import { useState } from "react"
import { Alert, ScrollView, StyleSheet, Text } from "react-native"
import { localApi as api } from "@lift/core"
import { SegmentRow, SettingsFooter, SettingsGroup } from "../../components/SettingRows"
import { useSettings, useWeightUnit } from "../../settings/SettingsProvider"
import { theme } from "../../theme/theme"
import { currentMode, setStoredMode, type ThemeMode } from "../../theme/themeMode"

export function GeneralSettingsScreen() {
  const unit = useWeightUnit()
  const { firstDayOfWeek } = useSettings()
  // Read once on mount; a change prompts for a restart, so nothing else
  // needs to follow it.
  const [themeMode, setThemeMode] = useState<ThemeMode>(currentMode())

  async function chooseTheme(m: ThemeMode) {
    if (m === themeMode) return
    await setStoredMode(m)
    setThemeMode(m)
    Alert.alert("Restart required", "Quit and reopen the app to apply the new theme.", [
      { text: "OK" },
    ])
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <Text style={styles.section}>Units</Text>
      <SettingsGroup>
        <SegmentRow
          label="Weight unit"
          options={[
            {
              label: "kg",
              active: unit === "kg",
              onPress: () => api.updateSettings({ weight_unit: "kg" }),
            },
            {
              label: "lb",
              active: unit === "lb",
              onPress: () => api.updateSettings({ weight_unit: "lb" }),
            },
          ]}
        />
        <SegmentRow
          label="First day of week"
          options={[
            {
              label: "Sun",
              active: firstDayOfWeek === 0,
              onPress: () => api.updateSettings({ first_day_of_week: 0 }),
            },
            {
              label: "Mon",
              active: firstDayOfWeek === 1,
              onPress: () => api.updateSettings({ first_day_of_week: 1 }),
            },
          ]}
        />
      </SettingsGroup>
      <SettingsFooter>
        Weights are stored in kg; the unit only changes how they show.
      </SettingsFooter>

      <Text style={styles.section}>Appearance</Text>
      <SettingsGroup>
        <SegmentRow
          label="Theme"
          options={[
            { label: "Dark", active: themeMode === "dark", onPress: () => chooseTheme("dark") },
            { label: "Light", active: themeMode === "light", onPress: () => chooseTheme("light") },
          ]}
        />
      </SettingsGroup>
      <SettingsFooter>A theme change applies after the app restarts.</SettingsFooter>
    </ScrollView>
  )
}

export const settingsPageStyles = StyleSheet.create({
  wrap: { padding: theme.spacing[4], gap: theme.spacing[3] },
  section: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: theme.spacing[3],
  },
})
const styles = settingsPageStyles
