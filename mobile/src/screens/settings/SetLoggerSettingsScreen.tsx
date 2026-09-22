import { ScrollView, Text } from "react-native"
import { localApi as api } from "@lift/core"
import { SettingsGroup, SwitchRow } from "../../components/SettingRows"
import { useSettings } from "../../settings/SettingsProvider"
import { theme } from "../../theme/theme"
import { settingsPageStyles as styles } from "./GeneralSettingsScreen"

export function SetLoggerSettingsScreen() {
  const { showPositionPrs, showRestTime, showTimeSinceLastSet } = useSettings()

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.wrap}
    >
      <Text style={styles.section}>Set list</Text>
      <SettingsGroup>
        <SwitchRow
          label="Per-set PRs"
          subtitle="A PR badge per set position, like 2PR"
          value={showPositionPrs}
          onChange={(v) => api.updateSettings({ show_position_prs: v })}
        />
        <SwitchRow
          label="Rest time between sets"
          subtitle="How long you rested, under each set number"
          value={showRestTime}
          onChange={(v) => api.updateSettings({ show_rest_time: v })}
        />
        <SwitchRow
          label="Time since last set"
          subtitle="A live timer under the set list"
          value={showTimeSinceLastSet}
          onChange={(v) => api.updateSettings({ show_time_since_last_set: v })}
        />
      </SettingsGroup>
    </ScrollView>
  )
}
