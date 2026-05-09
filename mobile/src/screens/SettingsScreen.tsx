import { useState } from "react"
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { localApi as api, useStore } from "@lift/core"
import type { Gym } from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import { ApiError } from "../auth/api"
import { Button } from "../components/Button"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { theme } from "../theme/theme"
import {
  currentMode,
  setStoredMode,
  type ThemeMode,
} from "../theme/themeMode"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"

type ProfileField = "username" | "email"

export function SettingsScreen({ navigation }: any) {
  const { user, logout, updateProfile } = useAuth()
  const unit = useWeightUnit()
  const { firstDayOfWeek, showPositionPrs } = useSettings()
  const gyms = useStore((s) => s.snapshot.gyms) as Gym[]
  // Read once on mount; the toggle prompts for restart so we don't need
  // a reactive subscription here.
  const [themeMode, setThemeMode] = useState<ThemeMode>(currentMode())

  const [recomputeBusy, setRecomputeBusy] = useState(false)
  const [recomputeStatus, setRecomputeStatus] = useState<
    | { kind: "ok" | "error"; msg: string }
    | null
  >(null)
  function recomputePrs() {
    Alert.alert(
      "Recompute all PRs?",
      "This clears every PR mark (current and historical) and re-derives them from your set history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Recompute",
          onPress: async () => {
            setRecomputeBusy(true)
            setRecomputeStatus(null)
            try {
              const res = await api.recomputePrs()
              setRecomputeStatus({
                kind: "ok",
                msg: `Recomputed PRs across ${res.recomputed} exercises.`,
              })
            } catch (e) {
              setRecomputeStatus({
                kind: "error",
                msg: e instanceof Error ? e.message : "Failed.",
              })
            } finally {
              setRecomputeBusy(false)
            }
          },
        },
      ]
    )
  }

  async function chooseTheme(m: ThemeMode) {
    if (m === themeMode) return
    await setStoredMode(m)
    setThemeMode(m)
    Alert.alert(
      "Restart required",
      "Quit and reopen the app to apply the new theme.",
      [{ text: "OK" }]
    )
  }

  const [gymDraft, setGymDraft] = useState("")
  const [gymBusy, setGymBusy] = useState(false)
  const [gymError, setGymError] = useState<string | null>(null)

  async function addGym() {
    const trimmed = gymDraft.trim()
    if (!trimmed || gymBusy) return
    setGymBusy(true)
    setGymError(null)
    try {
      await api.createGym(trimmed)
      setGymDraft("")
    } catch (e) {
      setGymError(e instanceof Error ? e.message : "Failed to add gym.")
    } finally {
      setGymBusy(false)
    }
  }
  function confirmDeleteGym(g: Gym) {
    if (g.id == null) return
    Alert.alert(
      "Remove gym?",
      `"${g.name}" will be removed from your saved gyms. Existing workouts that used this name will keep their gym text.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            if (g.id != null) api.deleteGym(g.id)
          },
        },
      ]
    )
  }

  const [editingField, setEditingField] = useState<ProfileField | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openEditor(field: ProfileField) {
    setEditingField(field)
    setDraft(field === "username" ? user?.username ?? "" : user?.email ?? "")
    setError(null)
  }
  function closeEditor() {
    setEditingField(null)
    setDraft("")
    setError(null)
  }
  async function saveProfile() {
    if (!editingField) return
    const trimmed = draft.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await updateProfile({ [editingField]: trimmed } as Partial<{
        username: string
        email: string
      }>)
      closeEditor()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <StaticSafeAreaView>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={styles.wrap}
      >
        <Text style={styles.section}>Account</Text>
        <View style={styles.card}>
          <EditableRow
            label="Username"
            value={user?.username ?? "—"}
            onPress={() => openEditor("username")}
          />
          <EditableRow
            label="Email"
            value={user?.email ?? "—"}
            onPress={() => openEditor("email")}
          />
        </View>

        <Text style={styles.section}>Preferences</Text>
        <View style={styles.card}>
          <Row label="Weight unit" value={unit.toUpperCase()} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="kg"
              variant={unit === "kg" ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ weight_unit: "kg" })}
            />
            <Button
              label="lb"
              variant={unit === "lb" ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ weight_unit: "lb" })}
            />
          </View>

          <Row
            label="First day of week"
            value={firstDayOfWeek === 1 ? "Monday" : "Sunday"}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="Sunday"
              variant={firstDayOfWeek === 0 ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ first_day_of_week: 0 })}
            />
            <Button
              label="Monday"
              variant={firstDayOfWeek === 1 ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ first_day_of_week: 1 })}
            />
          </View>

          <Row
            label="Theme"
            value={themeMode === "light" ? "Light" : "Dark"}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="Dark"
              variant={themeMode === "dark" ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => chooseTheme("dark")}
            />
            <Button
              label="Light"
              variant={themeMode === "light" ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => chooseTheme("light")}
            />
          </View>

          <Row
            label="Per-set PRs"
            value={showPositionPrs ? "On" : "Off"}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="On"
              variant={showPositionPrs ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ show_position_prs: true })}
            />
            <Button
              label="Off"
              variant={!showPositionPrs ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ show_position_prs: false })}
            />
          </View>
        </View>

        <Text style={styles.section}>Categories</Text>
        <Pressable
          onPress={() => navigation.navigate("CategoryStyles")}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Customize categories</Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.colors.muted}
            />
          </View>
        </Pressable>

        <Text style={styles.section}>Gyms</Text>
        <View style={styles.card}>
          <View style={styles.gymAddRow}>
            <TextInput
              value={gymDraft}
              onChangeText={setGymDraft}
              placeholder="Add a gym…"
              placeholderTextColor={theme.colors.muted}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={addGym}
              style={styles.gymInput}
            />
            <Button
              label={gymBusy ? "Adding…" : "Add"}
              onPress={addGym}
              disabled={!gymDraft.trim() || gymBusy}
            />
          </View>
          {gymError && <Text style={styles.modalError}>{gymError}</Text>}
          {gyms.length === 0 ? (
            <Text style={styles.gymEmpty}>No gyms yet.</Text>
          ) : (
            <View style={{ gap: theme.spacing[2] }}>
              {gyms.map((g) => (
                <View key={String(g.id ?? g.name)} style={styles.gymRow}>
                  <Text style={styles.gymName} numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Pressable
                    onPress={() => confirmDeleteGym(g)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.gymDeleteBtn,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color={theme.colors.destructive}
                    />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.section}>Maintenance</Text>
        <View style={styles.card}>
          <Text style={styles.maintenanceHelp}>
            Clears every PR mark and re-derives them from your set history.
            Useful if PRs got out of sync.
          </Text>
          <Button
            label={recomputeBusy ? "Recomputing…" : "Recompute PRs"}
            variant="secondary"
            onPress={recomputePrs}
            disabled={recomputeBusy}
          />
          {recomputeStatus && (
            <Text
              style={
                recomputeStatus.kind === "ok"
                  ? styles.statusOk
                  : styles.modalError
              }
            >
              {recomputeStatus.msg}
            </Text>
          )}
        </View>

        <View style={{ marginTop: theme.spacing[6] }}>
          <Button label="Log out" variant="destructive" onPress={logout} />
        </View>
      </ScrollView>

      <ProfileEditorModal
        visible={editingField != null}
        field={editingField}
        draft={draft}
        busy={busy}
        error={error}
        onChangeDraft={setDraft}
        onCancel={closeEditor}
        onSave={saveProfile}
      />
    </StaticSafeAreaView>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

function EditableRow({
  label,
  value,
  onPress,
}: {
  label: string
  value: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValueGroup}>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
        <Ionicons
          name="pencil"
          size={14}
          color={theme.colors.muted}
        />
      </View>
    </Pressable>
  )
}

function ProfileEditorModal({
  visible,
  field,
  draft,
  busy,
  error,
  onChangeDraft,
  onCancel,
  onSave,
}: {
  visible: boolean
  field: ProfileField | null
  draft: string
  busy: boolean
  error: string | null
  onChangeDraft: (s: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  const title = field === "email" ? "Edit email" : "Edit username"
  const canSave = draft.trim().length > 0 && !busy
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCancel}>
          <Pressable onPress={() => {}} style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TextInput
              value={draft}
              onChangeText={onChangeDraft}
              autoFocus
              autoCapitalize={field === "email" ? "none" : "none"}
              autoCorrect={false}
              keyboardType={field === "email" ? "email-address" : "default"}
              placeholderTextColor={theme.colors.muted}
              style={styles.modalInput}
            />
            {error && <Text style={styles.modalError}>{error}</Text>}
            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={onCancel}
                style={{ flex: 1 }}
              />
              <Button
                label={busy ? "Saving…" : "Save"}
                onPress={onSave}
                disabled={!canSave}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: theme.spacing[4], gap: theme.spacing[3] },
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
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowLabel: { color: theme.colors.muted, fontSize: theme.fontSize.sm },
  rowValue: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  rowValueGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "stretch",
    padding: theme.spacing[4],
  },
  modalCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  modalTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
  },
  modalInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  modalError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.xs,
  },
  modalActions: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  gymAddRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "stretch",
  },
  gymInput: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  gymRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  gymName: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  gymDeleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  gymEmpty: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontStyle: "italic",
  },
  maintenanceHelp: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
  },
  statusOk: {
    color: theme.colors.secondary,
    fontSize: theme.fontSize.xs,
  },
})
