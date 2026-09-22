import { useEffect, useState } from "react"
import {
  Alert,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import {
  hasCloudConflict,
  loadSyncClock,
  localApi as api,
  subscribeSyncClock,
  useStore,
} from "@lift/core"
import type { AIProviderId } from "@lift/core"
import { useAuth } from "../auth/AuthProvider"
import { ApiError } from "../auth/api"
import { AI_PROVIDERS } from "../ai"
import { clearApiKey, getApiKey, setApiKey } from "../ai/keys"
import { Button } from "../components/Button"
import { PopupModal } from "../components/PopupModal"
import { StaticSafeAreaView } from "../components/StaticSafeAreaView"
import { EXPAND_ANIM } from "../anim"
import { theme, tint } from "../theme/theme"
import { useSettings, useWeightUnit } from "../settings/SettingsProvider"
import { Card } from "../components/Card"
import { formatCutoff } from "../restTimer"
import { NavRow, SettingsGroup } from "../components/SettingRows"

type ProfileField = "username" | "email"

export function SettingsScreen({ navigation }: any) {
  const { user, logout, updateProfile } = useAuth()
  const unit = useWeightUnit()
  const { firstDayOfWeek, restTimerEnabled, restTimerCutoffS } = useSettings()

  // A refused push shows a dot here, because the automatic sync that hit it
  // runs in the background and the choice lives on the Import / Export screen.
  const [cloudConflict, setCloudConflict] = useState(() => hasCloudConflict())
  useEffect(() => {
    void loadSyncClock().then(() => setCloudConflict(hasCloudConflict()))
    return subscribeSyncClock(() => setCloudConflict(hasCloudConflict()))
  }, [])

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
              // The status line appears under the button and grows the card.
              LayoutAnimation.configureNext(EXPAND_ANIM)
              setRecomputeStatus({
                kind: "ok",
                msg: `Recomputed PRs across ${res.recomputed} exercises.`,
              })
            } catch (e) {
              LayoutAnimation.configureNext(EXPAND_ANIM)
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

  function confirmLogout() {
    Alert.alert("Log out?", "You can log back in at any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ])
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
        <Card>
          <EditableRow
            label="Username"
            value={user?.username ?? "-"}
            onPress={() => openEditor("username")}
          />
          <EditableRow
            label="Email"
            value={user?.email ?? "-"}
            onPress={() => openEditor("email")}
          />
        </Card>

        <Text style={styles.section}>Preferences</Text>
        <SettingsGroup inset>
          <NavRow
            icon="options-outline"
            title="General"
            subtitle={`${unit} · Week starts ${firstDayOfWeek === 1 ? "Monday" : "Sunday"}`}
            onPress={() => navigation.navigate("GeneralSettings")}
          />
          <NavRow
            icon="barbell-outline"
            title="Set logger"
            subtitle="PRs, rest times, and timers in the set list"
            onPress={() => navigation.navigate("SetLoggerSettings")}
          />
          <NavRow
            icon="timer-outline"
            title="Rest timer"
            subtitle={
              restTimerEnabled
                ? `On · Hides after ${formatCutoff(restTimerCutoffS)}`
                : "Off"
            }
            onPress={() => navigation.navigate("RestTimerSettings")}
          />
        </SettingsGroup>

        <Text style={styles.section}>Categories</Text>
        <SettingsGroup inset>
          <NavRow
            icon="color-palette-outline"
            title="Customize categories"
            subtitle="Names and colors"
            onPress={() => navigation.navigate("CategoryStyles")}
          />
        </SettingsGroup>

        {/* AI settings disabled for now.
        <Text style={styles.section}>AI</Text>
        <Card>
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
        </Card>
        */}

        <Text style={styles.section}>Data</Text>
        <SettingsGroup inset>
          <NavRow
            icon="cloud-outline"
            title="Backup & Restore"
            subtitle="Cloud sync and restore points"
            // Cloud sync lives on this screen, so an open conflict flags it.
            badge={cloudConflict}
            onPress={() => navigation.navigate("BackupRestore")}
          />
          <NavRow
            icon="swap-vertical-outline"
            title="Import / Export"
            subtitle="Lift JSON and FitNotes files"
            onPress={() => navigation.navigate("ImportExport")}
          />
        </SettingsGroup>

        <Text style={styles.section}>Gyms</Text>
        <SettingsGroup inset>
          <NavRow
            icon="location-outline"
            title="Manage gyms"
            subtitle="Rename or remove saved gyms"
            onPress={() => navigation.navigate("Gyms")}
          />
        </SettingsGroup>

        <Text style={styles.section}>Maintenance</Text>
        <Card>
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
        </Card>

        <View style={{ marginTop: theme.spacing[6] }}>
          <Button label="Log out" variant="destructive" onPress={confirmLogout} />
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
    backgroundColor: tint(0.04),
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
