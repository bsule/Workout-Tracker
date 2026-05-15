import { useEffect, useMemo, useState } from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { listExercisesQ, useStore } from "@lift/core"
import type { Exercise } from "@lift/core"
import { AI_PROVIDERS, getProvider } from "../ai"
import { applyPlan } from "../ai/applyPlan"
import { buildHistoryContext } from "../ai/buildContext"
import { getApiKey } from "../ai/keys"
import { parseAiPlanResponse } from "../ai/parse"
import { SYSTEM_PROMPT, buildUserPrompt } from "../ai/prompts"
import type { AiPlanResponse } from "../ai/types"
import { Button } from "../components/Button"
import { ExercisePickerSheet } from "../components/ExercisePickerSheet"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { useSettings } from "../settings/SettingsProvider"
import { pressedStyle } from "../theme/pressable"
import { theme } from "../theme/theme"

function todayString(): string {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}
function addDays(date: string, days: number): string {
  const dt = new Date(date + "T00:00:00")
  dt.setDate(dt.getDate() + days)
  return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}
function diffDays(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00")
  const b = Date.parse(to + "T00:00:00")
  return Math.round((b - a) / 86400000)
}

function enumerateDates(from: string, to: string): string[] {
  if (from > to) return []
  const out: string[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

export function AiPlanScreen({ navigation, route }: any) {
  const incomingStart: string | undefined = route?.params?.startDate
  const tomorrow = addDays(todayString(), 1)
  const initialStart = incomingStart && incomingStart > todayString() ? incomingStart : tomorrow

  const [planStart, setPlanStart] = useState<string>(initialStart)
  const [planEnd, setPlanEnd] = useState<string>(addDays(initialStart, 2))
  const [useHistory, setUseHistory] = useState<boolean>(true)
  const [historyStart, setHistoryStart] = useState<string>(addDays(todayString(), -30))
  const [historyEnd, setHistoryEnd] = useState<string>(todayString())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedExercises, setSelectedExercises] = useState<Exercise[]>([])
  const [comment, setComment] = useState("")

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<AiPlanResponse | null>(null)
  const [rawResponse, setRawResponse] = useState<string | null>(null)

  const { weightUnit } = useSettings()
  const settings = useStore((s) => s.snapshot.settings)
  const providerId = settings.ai_provider ?? "openai"
  const providerLabel = AI_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId

  const planDates = useMemo(() => enumerateDates(planStart, planEnd), [planStart, planEnd])
  const planDatesValid = planDates.length > 0 && planStart >= tomorrow
  const historyValid = !useHistory || historyStart <= historyEnd

  async function onGenerate() {
    setError(null)
    setPreview(null)
    setRawResponse(null)

    if (!planDatesValid) {
      setError("Pick a plan-for range starting tomorrow or later.")
      return
    }
    if (!historyValid) {
      setError("History start must be before history end.")
      return
    }

    const apiKey = await getApiKey(providerId)
    if (!apiKey) {
      setError(`No API key saved for ${providerLabel}. Add one in Settings.`)
      return
    }

    setBusy(true)
    try {
      const history = useHistory
        ? buildHistoryContext({
            from: historyStart,
            to: historyEnd,
            exerciseIds: selectedExercises.map((e) => e.id),
          })
        : []
      const exerciseLibrary = listExercisesQ({ sort: "last_performed" })
      const userPrompt = buildUserPrompt({
        planDates,
        weightUnit,
        exerciseLibrary,
        history,
        historyDisabled: !useHistory,
        historyFiltered: selectedExercises.length > 0,
        comment,
      })
      const raw = await getProvider(providerId).generate({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        apiKey,
      })
      setRawResponse(raw)
      try {
        const parsed = parseAiPlanResponse(raw)
        setPreview(parsed)
      } catch (parseErr) {
        setError(
          parseErr instanceof Error ? parseErr.message : "Failed to parse AI response"
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onApply() {
    if (!preview) return
    setBusy(true)
    try {
      const res = await applyPlan(preview)
      if (res.errors.length > 0) {
        Alert.alert(
          "Partial success",
          `Applied ${res.appliedDates.length} day(s). Failed: ${res.errors
            .map((e) => `${e.date}: ${e.message}`)
            .join("\n")}`,
          [{ text: "OK", onPress: () => navigation.goBack() }]
        )
      } else {
        navigation.goBack()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StaticSafeAreaView>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.title}>AI Plan</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.section}>Provider</Text>
          <View style={styles.card}>
            <Text style={styles.rowValue}>{providerLabel}</Text>
            <Text style={styles.help}>
              Change the provider or update API keys in Settings → AI.
            </Text>
          </View>

          <Text style={styles.section}>Plan for</Text>
          <View style={styles.card}>
            <DateRow
              label="Start"
              value={planStart}
              minDate={tomorrow}
              onChange={(v) => {
                setPlanStart(v)
                if (v > planEnd) setPlanEnd(v)
              }}
            />
            <DateRow
              label="End"
              value={planEnd}
              minDate={planStart}
              onChange={setPlanEnd}
            />
            <Text style={styles.help}>
              {planDatesValid
                ? `${planDates.length} day${planDates.length === 1 ? "" : "s"} will be planned.`
                : "Pick future dates (tomorrow or later)."}
            </Text>
          </View>

          <Text style={styles.section}>History context</Text>
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <Text style={styles.rowLabel}>Include past workouts</Text>
              <Switch
                value={useHistory}
                onValueChange={setUseHistory}
                trackColor={{
                  true: theme.colors.foreground,
                  false: theme.colors.border,
                }}
                thumbColor={theme.colors.background}
              />
            </View>
            {useHistory && (
              <>
                <DateRow
                  label="From"
                  value={historyStart}
                  onChange={(v) => {
                    setHistoryStart(v)
                    if (v > historyEnd) setHistoryEnd(v)
                  }}
                />
                <DateRow
                  label="To"
                  value={historyEnd}
                  onChange={setHistoryEnd}
                />
                <View style={{ gap: 6 }}>
                  <Text style={styles.rowLabel}>Limit to exercises</Text>
                  <View style={styles.chipsWrap}>
                    {selectedExercises.length === 0 ? (
                      <Text style={styles.help}>All exercises (no filter)</Text>
                    ) : (
                      selectedExercises.map((ex) => (
                        <Pressable
                          key={ex.id}
                          onPress={() =>
                            setSelectedExercises((cur) => cur.filter((e) => e.id !== ex.id))
                          }
                          style={({ pressed }) => [styles.exerciseChip, pressedStyle(pressed)]}
                        >
                          <Text style={styles.exerciseChipText}>{ex.name}</Text>
                          <Ionicons
                            name="close"
                            size={14}
                            color={theme.colors.muted}
                          />
                        </Pressable>
                      ))
                    )}
                  </View>
                  <Button
                    label={selectedExercises.length > 0 ? "Edit exercises" : "Pick exercises"}
                    variant="secondary"
                    onPress={() => setPickerOpen(true)}
                  />
                </View>
              </>
            )}
          </View>

          <Text style={styles.section}>Guidance (optional)</Text>
          <View style={styles.card}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="e.g. push/pull/legs split, focus on upper body, bad shoulder"
              placeholderTextColor={theme.colors.muted}
              style={styles.textArea}
              multiline
              numberOfLines={3}
            />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              {rawResponse && (
                <Text style={styles.rawText} numberOfLines={6}>
                  {rawResponse}
                </Text>
              )}
            </View>
          )}

          {preview && (
            <>
              <Text style={styles.section}>Preview</Text>
              <View style={styles.card}>
                {preview.days.length === 0 ? (
                  <Text style={styles.help}>The AI returned no days.</Text>
                ) : (
                  preview.days.map((d) => (
                    <View key={d.date} style={styles.previewDay}>
                      <Text style={styles.previewDate}>{niceDate(d.date)}</Text>
                      {d.exercises.length === 0 ? (
                        <Text style={styles.help}>Rest day</Text>
                      ) : (
                        d.exercises.map((ex, i) => (
                          <Text key={i} style={styles.previewExercise}>
                            {ex.name}
                            {ex.sets.length > 0
                              ? ` — ${ex.sets
                                  .map((s) => formatSet(s, weightUnit))
                                  .join(", ")}`
                              : ""}
                          </Text>
                        ))
                      )}
                    </View>
                  ))
                )}
              </View>
            </>
          )}

          <View style={styles.actions}>
            {preview ? (
              <>
                <Button
                  label="Discard"
                  variant="secondary"
                  onPress={() => {
                    setPreview(null)
                    setRawResponse(null)
                  }}
                  style={{ flex: 1 }}
                  disabled={busy}
                />
                <Button
                  label={busy ? "Applying…" : "Apply"}
                  onPress={onApply}
                  loading={busy}
                  style={{ flex: 1 }}
                />
              </>
            ) : (
              <Button
                label={busy ? "Generating…" : "Generate"}
                onPress={onGenerate}
                loading={busy}
                disabled={!planDatesValid || !historyValid}
                style={{ flex: 1 }}
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ExercisePickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={() => {}}
        mode="multi"
        initialSelectedIds={selectedExercises.map((e) => e.id)}
        onPickMany={(exs) => {
          setSelectedExercises(exs)
          setPickerOpen(false)
        }}
      />
    </StaticSafeAreaView>
  )
}

function DateRow({
  label,
  value,
  onChange,
  minDate,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  minDate?: string
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.dateGroup}>
        <Pressable
          onPress={() => {
            const next = addDays(value, -1)
            if (minDate && next < minDate) return
            onChange(next)
          }}
          hitSlop={10}
          style={({ pressed }) => [styles.dateBtn, pressedStyle(pressed)]}
        >
          <Ionicons name="chevron-back" size={16} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.dateText}>{niceDate(value)}</Text>
        <Pressable
          onPress={() => onChange(addDays(value, 1))}
          hitSlop={10}
          style={({ pressed }) => [styles.dateBtn, pressedStyle(pressed)]}
        >
          <Ionicons name="chevron-forward" size={16} color={theme.colors.foreground} />
        </Pressable>
      </View>
    </View>
  )
}

function niceDate(d: string): string {
  const dt = new Date(d + "T00:00:00")
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatSet(
  s: { weight?: number | null; reps?: number | null; distance_m?: number | null; time_seconds?: number | null },
  unit: string
): string {
  if (s.weight != null && s.reps != null) return `${s.weight}${unit}×${s.reps}`
  if (s.reps != null) return `×${s.reps}`
  if (s.distance_m != null && s.time_seconds != null)
    return `${s.distance_m}m / ${s.time_seconds}s`
  if (s.distance_m != null) return `${s.distance_m}m`
  if (s.time_seconds != null) return `${s.time_seconds}s`
  return "set"
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 36, alignItems: "center" },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "700",
  },
  wrap: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    paddingBottom: 80,
  },
  section: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: theme.spacing[3],
  },
  card: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: { color: theme.colors.muted, fontSize: theme.fontSize.sm },
  rowValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  help: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
  },
  dateGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  dateText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    minWidth: 110,
    textAlign: "center",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  exerciseChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.cardElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  exerciseChipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  textArea: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: theme.colors.inputBg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    minHeight: 80,
    textAlignVertical: "top",
  },
  errorBox: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.destructive,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing[3],
    gap: 6,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  rawText: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.font.mono,
  },
  previewDay: {
    gap: 4,
    paddingVertical: theme.spacing[2],
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewDate: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  previewExercise: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[4],
  },
})
