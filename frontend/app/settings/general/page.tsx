"use client"

import {
  SegmentRow,
  SettingsFooter,
  SettingsGroup,
  SettingsHeading,
  SettingsPage,
} from "@/components/settings/SettingRows"
import { useSettings } from "@/components/settings/SettingsProvider"
import { useTheme } from "@/components/settings/ThemeProvider"

export default function GeneralSettingsPage() {
  const { settings, update } = useSettings()
  const { theme, setTheme } = useTheme()
  const unit = settings.weight_unit
  const firstDayOfWeek = settings.first_day_of_week

  return (
    <SettingsPage title="General">
      <SettingsHeading>Units</SettingsHeading>
      <SettingsGroup>
        <SegmentRow
          label="Weight unit"
          options={[
            {
              label: "kg",
              active: unit === "kg",
              onSelect: () => void update({ weight_unit: "kg" }),
            },
            {
              label: "lb",
              active: unit === "lb",
              onSelect: () => void update({ weight_unit: "lb" }),
            },
          ]}
        />
        <SegmentRow
          label="First day of week"
          options={[
            {
              label: "Sun",
              active: firstDayOfWeek === 0,
              onSelect: () => void update({ first_day_of_week: 0 }),
            },
            {
              label: "Mon",
              active: firstDayOfWeek === 1,
              onSelect: () => void update({ first_day_of_week: 1 }),
            },
          ]}
        />
      </SettingsGroup>
      <SettingsFooter>
        Weights are stored in kg; the unit only changes how they show.
      </SettingsFooter>

      <SettingsHeading>Appearance</SettingsHeading>
      <SettingsGroup>
        <SegmentRow
          label="Theme"
          options={[
            { label: "Dark", active: theme === "dark", onSelect: () => setTheme("dark") },
            { label: "Light", active: theme === "light", onSelect: () => setTheme("light") },
          ]}
        />
      </SettingsGroup>
    </SettingsPage>
  )
}
