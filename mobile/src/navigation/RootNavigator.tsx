import { Pressable, StyleSheet, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import {
  createNavigationContainerRef,
  NavigationContainer,
  DefaultTheme,
} from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { useAuth } from "../auth/AuthProvider"
import { theme } from "../theme/theme"
import { LoginScreen } from "../screens/LoginScreen"
import { SignupScreen } from "../screens/SignupScreen"
import { DayScreen } from "../screens/DayScreen"
import { CalendarScreen } from "../screens/CalendarScreen"
import { EditExerciseScreen } from "../screens/EditExerciseScreen"
import { ExerciseDetailScreen } from "../screens/ExerciseDetailScreen"
import { ExercisePickerScreen } from "../screens/ExercisePickerScreen"
import { ExercisesScreen } from "../screens/ExercisesScreen"
import { OneRepMaxScreen } from "../screens/OneRepMaxScreen"
import { SettingsScreen } from "../screens/SettingsScreen"
import { NewExerciseScreen } from "../screens/NewExerciseScreen"
import { SetLoggerScreen } from "../screens/SetLoggerScreen"
import { CategoryStylesScreen } from "../screens/CategoryStylesScreen"
import { GymsScreen } from "../screens/GymsScreen"
import { ImportExportScreen } from "../screens/ImportExportScreen"

const Stack = createNativeStackNavigator()
const Tabs = createBottomTabNavigator()

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.background,
    card: theme.colors.card,
    text: theme.colors.foreground,
    border: theme.colors.border,
    primary: theme.colors.primary,
    notification: theme.colors.destructive,
  },
}

const screenOptions = {
  headerStyle: { backgroundColor: theme.colors.background },
  headerTintColor: theme.colors.foreground,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: theme.colors.background },
  sceneStyle: { backgroundColor: theme.colors.background },
  cardStyle: { backgroundColor: theme.colors.background },
}

// Native-stack-only options. Forces the iOS back button to show only a
// chevron, not the previous screen's title.
// animationDuration shortens the iOS push from the ~350ms default so taps on
// home-tab rows (Settings → CategoryStyles/Gyms/ImportExport, Exercises →
// ExerciseDetail/EditExercise, etc.) feel near-instant.
const stackScreenOptions = {
  ...screenOptions,
  headerBackButtonDisplayMode: "minimal" as const,
  headerBackTitle: "",
  headerBackTitleVisible: false,
  animationDuration: 180,
}

const navigationRef = createNavigationContainerRef()

function todayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number) {
  return String(n).padStart(2, "0")
}

// Stub component used as the route target for the center "+" tab. The tab's
// custom button intercepts the press and opens the picker sheet instead of
// rendering this screen, but bottom-tab navigator still requires a component.
function NoopScreen() {
  return null
}

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap
  color: string
  focused: boolean
}) {
  return (
    <View style={styles.tabIcon}>
      <Ionicons
        name={name}
        size={22}
        color={focused ? theme.colors.foreground : color}
        style={focused && styles.tabIconFocused}
      />
    </View>
  )
}

function MainTabs() {
  return (
    <>
      <Tabs.Navigator
        // Pre-mount every tab. Lazy mount on first focus is the cause of the
        // "header pops in late / content shifts" jank — the screen first
        // renders before its container has been measured, then re-renders.
        // Eager mount is cheap here (no big screens) and gives a smooth
        // first focus.
        screenOptions={{
          ...screenOptions,
          headerShown: false,
          lazy: false,
          sceneStyle: { backgroundColor: theme.colors.background },
          tabBarStyle: {
            backgroundColor: theme.colors.background,
            borderTopColor: theme.colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
            height: 70,
            paddingTop: 8,
            paddingBottom: 10,
          },
          tabBarShowLabel: false,
          tabBarActiveTintColor: theme.colors.foreground,
          tabBarInactiveTintColor: theme.colors.muted,
        }}
      >
        <Tabs.Screen
          name="Today"
          component={DayScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="today-outline" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="Exercises"
          component={ExercisesScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="barbell-outline" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="Add"
          component={NoopScreen}
          options={{
            tabBarIcon: () => <Ionicons name="add" size={26} color={theme.colors.muted} />,
            tabBarButton: (props: any) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => (navigationRef as any).navigate("ExercisePicker")}
                // Pressable's iOS default delays onPress until pressOut +
                // a scroll-detection window (~130ms). The "+" tab button
                // isn't inside a scrollable, so the delay is pure latency
                // — drop it so the picker push starts on touch-up.
                unstable_pressDelay={0}
                style={[props.style, styles.fabBtn]}
              >
                {props.children}
              </Pressable>
            ),
          }}
        />
        <Tabs.Screen
          name="Calendar"
          component={CalendarScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="calendar-outline" color={color} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="settings-outline" color={color} focused={focused} />
            ),
          }}
        />
      </Tabs.Navigator>
    </>
  )
}

export function RootNavigator() {
  const { user } = useAuth()
  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      <Stack.Navigator screenOptions={stackScreenOptions}>
        {user ? (
          <>
            <Stack.Screen
              name="Main"
              component={MainTabs}
              // freezeOnBlur suspends the entire MainTabs subtree (every
              // pre-mounted bottom tab — DayScreen, ExercisesScreen,
              // CalendarScreen, SettingsScreen) while a pushed stack screen
              // like SetLogger is on top. Without this, every snapshot
              // mutation made on SetLogger fans out to listExercisesQ in
              // ExercisesScreen, getCalendarQ in CalendarScreen, etc., even
              // though none of them are visible — adding noticeable lag to
              // SetLogger's first-paint settle. Frozen tabs unfreeze and
              // re-render once when the user navigates back.
              options={{ headerShown: false, freezeOnBlur: true }}
            />
            <Stack.Screen
              name="ExerciseDetail"
              component={ExerciseDetailScreen}
              options={{ title: "" }}
            />
            {/* Stack-pushed Calendar instance used by the calendar-outline
              * button on ExerciseDetail's history. Pushing on the stack keeps
              * MainTabs frozen — without this, popping ExerciseDetail to switch
              * to the Calendar tab unfreezes every pre-mounted tab on the same
              * JS frame as the pop animation, which the user perceives as a
              * slow open. Reuses the existing CalendarScreen component. */}
            <Stack.Screen
              name="CalendarDate"
              component={CalendarScreen}
              // Slightly snappier than the global 180ms — the calendar
              // renders fully before the slide finishes, so a shorter
              // animation just gets the user to the content faster.
              options={{ headerShown: false, animationDuration: 120 }}
            />
            <Stack.Screen
              name="EditExercise"
              component={EditExerciseScreen}
              options={{ headerShown: false, presentation: "modal" }}
            />
            <Stack.Screen
              name="ExercisePicker"
              component={ExercisePickerScreen}
              // Standard right-to-left push. Using the native default keeps the
              // picker → SetLogger transition (via navigation.replace) as a
              // single continuous slide, and avoids the slower bottom-sheet
              // feel of `slide_from_bottom`.
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OneRepMax"
              component={OneRepMaxScreen}
              options={{ headerShown: false, presentation: "modal" }}
            />
            <Stack.Screen
              name="NewExercise"
              component={NewExerciseScreen}
              options={{ title: "New exercise", presentation: "modal" }}
            />
            <Stack.Screen
              name="CategoryStyles"
              component={CategoryStylesScreen}
              options={{ title: "Categories" }}
            />
            <Stack.Screen
              name="Gyms"
              component={GymsScreen}
              options={{ title: "Gyms" }}
            />
            <Stack.Screen
              name="ImportExport"
              component={ImportExportScreen}
              options={{ title: "Import / Export" }}
            />
            <Stack.Screen
              name="SetLogger"
              component={SetLoggerScreen}
              // Native iOS nav-bar buttons add their own circular press-state
              // highlight that we can't disable from JS. Hide the native
              // header and render the back chevron in-screen so it matches
              // the DayScreen date-nav chevrons exactly.
              options={{ headerShown: false }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  tabIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconFocused: {
    textShadowColor: "rgba(255,255,255,0.55)",
    textShadowRadius: 8,
  },
  // Empty style — kept so we can spread the default tab button style and
  // optionally override later.
  fabBtn: {},
})
