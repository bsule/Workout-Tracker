"use client"

import {
  SettingsGroup,
  SettingsHeading,
  SettingsPage,
  SwitchRow,
} from "@/components/settings/SettingRows"
import { useSettings } from "@/components/settings/SettingsProvider"
import { readSettings } from "@lift/core/settings"

export default function SetLoggerSettingsPage() {
  const { settings, update } = useSettings()
  const s = readSettings(settings)

  return (
    <SettingsPage title="Set logger">
      <SettingsHeading>Set list</SettingsHeading>
      <SettingsGroup>
        <SwitchRow
          label="Per-set PRs"
          subtitle="A PR badge per set position, like 2PR"
          value={s.showPositionPrs}
          onChange={(v) => void update({ show_position_prs: v })}
        />
        <SwitchRow
          label="Rest time between sets"
          subtitle="How long you rested, under each set number"
          value={s.showRestTime}
          onChange={(v) => void update({ show_rest_time: v })}
        />
        <SwitchRow
          label="Time since last set"
          subtitle="A live timer under the set list"
          value={s.showTimeSinceLastSet}
          onChange={(v) => void update({ show_time_since_last_set: v })}
        />
        <SwitchRow
          label="Estimated 1RM"
          subtitle="Your estimated one-rep max, under each set"
          value={s.showOneRm}
          onChange={(v) => void update({ show_one_rm: v })}
        />
        <SwitchRow
          label="Last time"
          subtitle="Your last session and top weights, under the set list"
          value={s.showLastTime}
          onChange={(v) => void update({ show_last_time: v })}
        />
      </SettingsGroup>
    </SettingsPage>
  )
}
