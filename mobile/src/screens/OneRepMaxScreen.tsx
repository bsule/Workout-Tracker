import { useMemo, useState } from "react"
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  defaultStep,
  estimateOneRm,
  formatWeight,
  fromKg,
  roundForDisplay,
  toKg,
} from "@lift/core"
import { theme } from "../theme/theme"
import { useWeightUnit } from "../settings/SettingsProvider"

const PERCENT_TABLE = [95, 90, 85, 80, 75, 70, 65, 60]

export function OneRepMaxScreen({ navigation }: any) {
  const unit = useWeightUnit()
  const step = defaultStep(unit)
  const [weight, setWeight] = useState<number>(unit === "kg" ? 60 : 135)
  const [reps, setReps] = useState<number>(5)

  const oneRmKg = useMemo(() => {
    const kg = toKg(weight, unit)
    return estimateOneRm(kg, reps)
  }, [weight, reps, unit])

  const oneRmDisplay = roundForDisplay(fromKg(oneRmKg, unit), unit)

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        edges={["top"]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.headerSideBtn}
          >
            <Ionicons name="close" size={28} color={theme.colors.foreground} />
          </Pressable>
          <Text style={styles.title}>1 Rep Max</Text>
          <View style={styles.headerSideBtn} />
        </View>

        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.resultCard}>
            <Text style={styles.resultLabel}>Estimated 1RM</Text>
            <View style={styles.resultRow}>
              <Text style={styles.resultValue}>
                {formatWeight(oneRmKg, unit)}
              </Text>
              <Text style={styles.resultUnit}>{unit}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <NumericField
              label="Weight"
              unit={unit}
              value={weight}
              step={step}
              min={0}
              onChange={setWeight}
            />
            <NumericField
              label="Reps"
              value={reps}
              step={1}
              min={1}
              onChange={setReps}
            />
          </View>

          {oneRmDisplay > 0 && reps > 0 && (
            <View style={styles.percentCard}>
              <Text style={styles.section}>% of 1RM</Text>
              {PERCENT_TABLE.map((pct) => {
                const w = roundForDisplay((oneRmDisplay * pct) / 100, unit)
                return (
                  <View key={pct} style={styles.percentRow}>
                    <Text style={styles.percentLabel}>{pct}%</Text>
                    <Text style={styles.percentValue}>
                      {w} <Text style={styles.percentUnit}>{unit}</Text>
                    </Text>
                  </View>
                )
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  )
}

function NumericField({
  label,
  unit,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  unit?: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {unit && <Text style={styles.fieldUnit}>{unit}</Text>}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={styles.stepBtn}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <TextInput
          value={String(value)}
          onChangeText={(t) => {
            const n = Number(t.replace(/[^0-9.\-]/g, ""))
            onChange(Number.isFinite(n) ? n : 0)
          }}
          keyboardType="numeric"
          selectTextOnFocus
          style={styles.numericInput}
        />
        <Pressable onPress={() => onChange(value + step)} style={styles.stepBtn}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  headerSideBtn: { width: 32, alignItems: "center" },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.md, fontWeight: "700" },
  wrap: { padding: theme.spacing[4], gap: theme.spacing[4] },
  resultCard: {
    backgroundColor: theme.colors.card,
    borderColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[5],
    alignItems: "center",
    gap: 4,
  },
  resultLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  resultRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  resultValue: {
    color: theme.colors.foreground,
    fontSize: 48,
    fontWeight: "800",
  },
  resultUnit: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.md,
    fontWeight: "600",
  },
  formulaLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    marginTop: 2,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[5],
    gap: theme.spacing[4],
  },
  fieldLabel: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  fieldUnit: { color: theme.colors.muted, fontSize: 10, textTransform: "uppercase" },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: theme.colors.foreground, fontSize: 22, fontWeight: "600" },
  numericInput: {
    flex: 1,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    backgroundColor: "rgba(255,255,255,0.03)",
    color: theme.colors.foreground,
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  section: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: theme.spacing[2],
  },
  percentCard: {
    backgroundColor: theme.colors.card,
    borderColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
    gap: 0,
  },
  percentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomColor: "rgba(255,255,255,0.05)",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  percentLabel: {
    width: 56,
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  percentValue: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    textAlign: "right",
  },
  percentUnit: { color: theme.colors.muted, fontSize: 11, fontWeight: "400" },
})
