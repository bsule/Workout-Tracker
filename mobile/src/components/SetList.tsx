import { memo } from "react"
import { StyleSheet, Text, View } from "react-native"
import { formatWeight } from "@lift/core"
import { PrIcon } from "./PrIcon"
import { theme } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"

interface DisplaySet {
  id: number
  weight: number | null
  reps: number | null
  is_pr: boolean
  was_pr: boolean
  is_position_pr: boolean
  was_position_pr: boolean
  is_planned?: boolean
}

interface Props {
  sets: DisplaySet[]
}

export const SetList = memo(function SetList({ sets }: Props) {
  const unit = useWeightUnit()
  const { showPositionPrs } = useSettings()
  return (
    <View>
      {sets.map((s, i) => (
        <View key={s.id} style={[styles.setRow, s.is_planned && { opacity: 0.6 }]}>
          <View style={styles.setIcon}>
            {s.is_planned ? (
              <View style={styles.plannedDot} />
            ) : s.is_pr || s.was_pr ? (
              <PrIcon historical={!s.is_pr && s.was_pr} />
            ) : showPositionPrs && (s.is_position_pr || s.was_position_pr) ? (
              <PrIcon
                variant="position"
                position={i + 1}
                historical={!s.is_position_pr && s.was_position_pr}
              />
            ) : null}
          </View>
          <Text style={styles.setIndex}>{i + 1}</Text>
          <Text
            style={[
              styles.setWeight,
              s.is_planned && { fontStyle: "italic", color: theme.colors.muted },
            ]}
          >
            {formatWeight(s.weight, unit)} <Text style={styles.setUnit}>{unit}</Text>
          </Text>
          <Text
            style={[
              styles.setReps,
              s.is_planned && { fontStyle: "italic", color: theme.colors.muted },
            ]}
          >
            {s.reps ?? "—"}
          </Text>
        </View>
      ))}
    </View>
  )
})

const styles = StyleSheet.create({
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 8,
    gap: theme.spacing[3],
    borderBottomColor: "rgba(255,255,255,0.18)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setIcon: { width: 28, alignItems: "flex-start" },
  plannedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    borderWidth: 1.5,
  },
  setIndex: {
    width: 24,
    color: theme.colors.muted,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  setWeight: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    textAlign: "center",
  },
  setUnit: { color: theme.colors.muted, fontSize: 12, fontWeight: "400" },
  setReps: {
    width: 50,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    textAlign: "right",
  },
})
