// Rows for the Settings screen and its sub-pages. A SettingsGroup is one card;
// the rows inside it are separated by an inset divider, like iOS Settings.

import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react"
import { Pressable, StyleSheet, Switch, Text, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { theme } from "../theme/theme"
import { pressedStyle } from "../theme/pressable"

const ICON_SIZE = 32

/** One card of rows. Pass `inset` when the rows have icons, so the divider
 *  starts after the icon tile. */
export function SettingsGroup({
  children,
  inset = false,
}: {
  children: ReactNode
  inset?: boolean
}) {
  const rows = Children.toArray(children)
  return (
    <View style={styles.group}>
      {rows.map((row, i) => (
        // Children.toArray gives every row a key of its own (its explicit key,
        // or its position among the written children), so a row shown or
        // hidden conditionally does not shift the ones after it.
        <Fragment key={isValidElement(row) ? (row.key ?? i) : i}>
          {i > 0 && <View style={[styles.divider, inset && styles.dividerInset]} />}
          {row}
        </Fragment>
      ))}
    </View>
  )
}

/** Small print under a group. */
export function SettingsFooter({ children }: { children: ReactNode }) {
  return <Text style={styles.footer}>{children}</Text>
}

/** A row that opens another screen: icon tile, title, subtitle, chevron. */
export function NavRow({
  icon,
  title,
  subtitle,
  badge,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"]
  title: string
  subtitle?: string
  badge?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.navRow, pressedStyle(pressed)]}
    >
      <View style={styles.icon}>
        <Ionicons name={icon} size={18} color={theme.colors.foreground} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {badge && <View style={styles.badge} />}
      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
    </Pressable>
  )
}

/** An on/off setting. A tap anywhere on the row toggles it. */
export function SwitchRow({
  label,
  subtitle,
  value,
  onChange,
}: {
  label: string
  subtitle?: string
  value: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.row, pressedStyle(pressed)]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={styles.text}>
        <Text style={styles.title}>{label}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {/* Display only. With its own handler the switch and the row both
          claim the tap, and a tap on the switch did nothing. */}
      <View pointerEvents="none">
        <Switch
          value={value}
          trackColor={{ true: theme.colors.secondary, false: theme.colors.cardElevated }}
          thumbColor={theme.colors.foreground}
          ios_backgroundColor={theme.colors.cardElevated}
        />
      </View>
    </Pressable>
  )
}

/** A setting with two or three short choices, drawn as a segmented control. */
export function SegmentRow({
  label,
  options,
}: {
  label: string
  options: { label: string; active: boolean; onPress: () => void }[]
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.title, styles.text]}>{label}</Text>
      <View style={styles.segments}>
        {options.map((o) => (
          <Pressable
            key={o.label}
            onPress={o.active ? undefined : o.onPress}
            style={[styles.segment, o.active && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: o.active }}
          >
            <Text style={[styles.segmentText, o.active && styles.segmentTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/** A setting whose value opens an editor: label, current value, chevron. */
export function ValueRow({
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
      style={({ pressed }) => [styles.row, pressedStyle(pressed)]}
    >
      <Text style={[styles.title, styles.text]}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginLeft: theme.spacing[4],
  },
  dividerInset: {
    marginLeft: theme.spacing[4] + ICON_SIZE + theme.spacing[3],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    minHeight: 52,
  },
  navRow: { minHeight: 60 },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: 2 },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  subtitle: { color: theme.colors.muted, fontSize: theme.fontSize.xs },
  value: { color: theme.colors.muted, fontSize: theme.fontSize.base },
  badge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.destructive,
  },
  segments: {
    flexDirection: "row",
    backgroundColor: theme.colors.inputBg,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: 2,
  },
  segment: {
    minWidth: 56,
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 6,
    borderRadius: theme.radius.md - 2,
  },
  segmentActive: { backgroundColor: theme.colors.cardElevated },
  segmentText: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  segmentTextActive: { color: theme.colors.foreground },
  footer: {
    color: theme.colors.muted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    marginTop: -theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
})
