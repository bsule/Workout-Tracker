import { memo } from "react"
import { StyleSheet, Text, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { setPositions, setValueText } from "@lift/core/setLogger"
import { PrIcon } from "./PrIcon"
import { theme, line } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"

interface DisplaySet {
  id: number
  weight: number | null
  reps: number | null
  distance_m?: number | null
  distance_unit_display?: string
  time_seconds?: number | null
  /** History rows carry their own set position (see setPositions). */
  position?: number
  is_pr: boolean
  was_pr: boolean
  is_position_pr: boolean
  was_position_pr: boolean
  is_planned?: boolean
  note?: string
}

interface Props {
  sets: DisplaySet[]
  /** Cardio stores minutes in `weight` and a level in `reps`, unconverted. */
  isCardio?: boolean
  /** When true, render each set's note beneath its row (same look as the
   *  log-set page). Off by default so the compact day-view cards stay clean. */
  showNotes?: boolean
}

export const SetList = memo(function SetList({ sets, isCardio = false, showNotes }: Props) {
  const unit = useWeightUnit()
  const { showPositionPrs } = useSettings()
  const positions = setPositions(sets)
  return (
    <View>
      {sets.map((s, i) => {
        const value = setValueText(s, unit, isCardio)
        return (
        <View key={s.id} style={[styles.setGroup, s.is_planned && { opacity: 0.6 }]}>
          <View style={styles.setRow}>
            <View style={styles.setIcon}>
              {s.is_planned ? (
                <View style={styles.plannedDot} />
              ) : s.is_pr || s.was_pr ? (
                <PrIcon historical={!s.is_pr && s.was_pr} />
              ) : showPositionPrs && (s.is_position_pr || s.was_position_pr) ? (
                <PrIcon
                  variant="position"
                  position={positions[i]}
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
              {value.amount}
              {/* The space stays outside the unit's smaller text, as before. */}
              {!!value.unit && " "}
              {!!value.unit && <Text style={styles.setUnit}>{value.unit}</Text>}
            </Text>
            <Text
              style={[
                styles.setReps,
                s.is_planned && { fontStyle: "italic", color: theme.colors.muted },
              ]}
            >
              {value.reps}
            </Text>
          </View>
          {showNotes && !s.is_planned && !!s.note && (
            <View style={styles.setNoteLine}>
              <Ionicons
                name="document-text-outline"
                size={11}
                color={theme.colors.muted}
              />
              <Text style={styles.setNoteText}>{s.note}</Text>
            </View>
          )}
        </View>
        )
      })}
    </View>
  )
})

const styles = StyleSheet.create({
  setGroup: {
    borderBottomColor: line(0.18),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 8,
    gap: theme.spacing[3],
  },
  setNoteLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginLeft: 40,
    marginTop: 2,
    paddingRight: 8,
    paddingBottom: 8,
  },
  setNoteText: {
    flex: 1,
    color: theme.colors.muted,
    fontSize: 11.5,
    fontStyle: "italic",
    lineHeight: 16,
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
    minWidth: 50,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    textAlign: "right",
  },
})
