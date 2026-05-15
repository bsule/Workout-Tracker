import { useEffect, useState } from "react"
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { localApi as api, useStore } from "@lift/core"
import type { AIProviderId } from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import { ApiError } from "../auth/api"
import { AI_PROVIDERS } from "../ai"
import { clearApiKey, getApiKey, setApiKey } from "../ai/keys"
import { Button } from "../components/Button"
import { PopupModal } from "../components/PopupModal"
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
  const { firstDayOfWeek, showPositionPrs, showRestTime } = useSettings()
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

  const [editingField, setEditingField] = useState<ProfileField | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storedProvider: AIProviderId =
    useStore((s) => s.snapshot.settings.ai_provider) ?? "openai"
  const [pendingProvider, setPendingProvider] = useState<AIProviderId | null>(null)
  const aiProvider: AIProviderId = pendingProvider ?? storedProvider
  useEffect(() => {
    if (pendingProvider && pendingProvider === storedProvider) {
      setPendingProvider(null)
    }
  }, [pendingProvider, storedProvider])
  function selectProvider(id: AIProviderId) {
    if (id === aiProvider) return
    setPendingProvider(id)
    // applyMutation rebuilds snapshot indexes and re-renders every
    // SettingsProvider descendant; double-RAF lets the optimistic button
    // re-render paint before the JS thread blocks on that work.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        api.updateSettings({ ai_provider: id })
      })
    })
  }
  const [keyPresence, setKeyPresence] = useState<Record<AIProviderId, boolean>>(
    { openai: false, anthropic: false, gemini: false, deepseek: false }
  )
  const [editingKey, setEditingKey] = useState<AIProviderId | null>(null)
  const [keyDraft, setKeyDraft] = useState("")
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  async function refreshKeyPresence() {
    const next: Record<AIProviderId, boolean> = { ...keyPresence }
    for (const p of AI_PROVIDERS) {
      next[p.id] = !!(await getApiKey(p.id))
    }
    setKeyPresence(next)
  }
  useEffect(() => {
    refreshKeyPresence()
  }, [])

  function openKeyEditor(id: AIProviderId) {
    setEditingKey(id)
    setKeyDraft("")
    setKeyError(null)
  }
  function closeKeyEditor() {
    setEditingKey(null)
    setKeyDraft("")
    setKeyError(null)
  }
  async function saveKey() {
    if (!editingKey) return
    const value = keyDraft.trim()
    if (!value) return
    setKeyBusy(true)
    setKeyError(null)
    try {
      await setApiKey(editingKey, value)
      await refreshKeyPresence()
      closeKeyEditor()
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Failed to save key.")
    } finally {
      setKeyBusy(false)
    }
  }
  async function deleteKey(id: AIProviderId) {
    await clearApiKey(id)
    await refreshKeyPresence()
  }

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
        keyboardShouldPersistTaps="handled"
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

          <Row
            label="Rest time between sets"
            value={showRestTime ? "On" : "Off"}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="On"
              variant={showRestTime ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ show_rest_time: true })}
            />
            <Button
              label="Off"
              variant={!showRestTime ? "primary" : "secondary"}
              style={{ flex: 1 }}
              onPress={() => api.updateSettings({ show_rest_time: false })}
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

        <Text style={styles.section}>AI</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>Active provider</Text>
          <View style={styles.providerGrid}>
            {AI_PROVIDERS.map((p) => (
              <Button
                key={p.id}
                label={p.label}
                variant={aiProvider === p.id ? "primary" : "secondary"}
                style={styles.providerBtn}
                onPress={() => selectProvider(p.id)}
              />
            ))}
          </View>

          {AI_PROVIDERS.map((p) => {
            const has = keyPresence[p.id]
            return (
              <View key={p.id} style={styles.aiKeyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowValue}>{p.label}</Text>
                  <Text style={styles.maintenanceHelp}>
                    {has ? "Key saved" : "No key set"}
                  </Text>
                </View>
                <View style={styles.aiKeyActions}>
                  <Button
                    label={has ? "Update" : "Set"}
                    variant="secondary"
                    onPress={() => openKeyEditor(p.id)}
                  />
                  {has && (
                    <Button
                      label="Clear"
                      variant="destructive"
                      onPress={() => deleteKey(p.id)}
                    />
                  )}
                </View>
              </View>
            )
          })}
        </View>

        <Text style={styles.section}>Data</Text>
        <Pressable
          onPress={() => navigation.navigate("ImportExport")}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Import / Export</Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.colors.muted}
            />
          </View>
        </Pressable>

        <Text style={styles.section}>Gyms</Text>
        <Pressable
          onPress={() => navigation.navigate("Gyms")}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Manage gyms</Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.colors.muted}
            />
          </View>
        </Pressable>

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

      <PopupModal
        visible={editingKey != null}
        title={
          editingKey
            ? `${AI_PROVIDERS.find((p) => p.id === editingKey)?.label} API key`
            : ""
        }
        onClose={closeKeyEditor}
      >
        <TextInput
          value={keyDraft}
          onChangeText={setKeyDraft}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="Paste your API key"
          placeholderTextColor={theme.colors.muted}
          style={styles.modalInput}
        />
        {keyError && <Text style={styles.modalError}>{keyError}</Text>}
        <View style={styles.modalActions}>
          <Button
            label="Cancel"
            variant="secondary"
            onPress={closeKeyEditor}
            style={{ flex: 1 }}
          />
          <Button
            label={keyBusy ? "Saving…" : "Save"}
            onPress={saveKey}
            disabled={!keyDraft.trim() || keyBusy}
            style={{ flex: 1 }}
          />
        </View>
      </PopupModal>
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
    <PopupModal visible={visible} title={title} onClose={onCancel}>
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
    </PopupModal>
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
  maintenanceHelp: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
  },
  statusOk: {
    color: theme.colors.secondary,
    fontSize: theme.fontSize.xs,
  },
  providerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  providerBtn: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  aiKeyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: theme.spacing[2],
    borderTopColor: theme.colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  aiKeyActions: {
    flexDirection: "row",
    gap: 8,
  },
})
