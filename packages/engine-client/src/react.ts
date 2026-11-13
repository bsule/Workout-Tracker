import { createContext, createElement, useContext, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { EngineClient, type QueryState } from './index'
import type { AccountEngineSession } from './session'
import type { WorkoutApi } from './workout-api'
import type { EngineDataApi } from './data-api'
import type { Workout, Exercise, Gym, CalendarMap, UserSettings, ExerciseHistoryDay, Category } from '@lift/core'

export interface EngineContextValue {
  session: AccountEngineSession
  client: EngineClient
  api: WorkoutApi
  data?: EngineDataApi
}

export const EngineContext = createContext<EngineContextValue | null>(null)

export function EngineProvider({ value, children }: { value: EngineContextValue; children: ReactNode }) {
  return createElement(EngineContext.Provider, { value }, children)
}

export function useEngineSession(): AccountEngineSession {
  const ctx = useContext(EngineContext)
  if (!ctx) throw new Error('useEngineSession must be used within EngineProvider')
  return ctx.session
}

export function useEngineClient(): EngineClient {
  return useEngineSession().client
}

export function useWorkoutApi(): WorkoutApi {
  return useEngineSession().api
}

export function useEngineDataApi(): EngineDataApi | undefined {
  return useEngineSession().data
}

export interface QueryOptions {
  /** False while the screen is covered: keep showing the last result and do
   * not refetch on every commit. Defaults to true. */
  active?: boolean
  /** While inactive, a one-off catch-up (the screen is about to be revealed). */
  onReturn?: (listener: () => void) => () => void
}

/** Pass a stable queryKey covering all arguments and an immutable query object. */
export function useEngineQuery<T>(client: EngineClient, queryKey: string, query: unknown, options?: QueryOptions): QueryState<T> {
  const active = options?.active ?? true
  const onReturn = options?.onReturn
  const subscribe = useCallback((listener: () => void) => {
    if (active) return client.subscribe(queryKey, query, listener)
    let live = true
    const notify = () => { if (live) listener() }
    // A screen mounted while covered (a tab not yet shown) reads once, so it
    // is not blank when revealed; it then stays frozen until focus or return.
    if (client.snapshot(queryKey, query).status !== 'ready') {
      void client.prefetch(queryKey, query).then(notify, notify)
    }
    const stop = onReturn?.(() => {
      void client.prefetch(queryKey, query).then(notify, notify)
    })
    return () => { live = false; stop?.() }
  }, [client, queryKey, query, active, onReturn])
  const getSnapshot = useCallback(() => client.snapshot<T>(queryKey, query), [client, queryKey, query])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The value of a query, `fallback` while it loads. A failed read throws so
 * the nearest error boundary shows it, instead of rendering as empty data. */
export function queryValue<T, F = T>(state: QueryState<T>, fallback: F): T | F {
  if (state.status === 'error') throw state.error
  return state.status === 'ready' ? state.value : fallback
}

export function useQuery<T>(queryKey: string, query: unknown, options?: QueryOptions): QueryState<T> {
  const client = useEngineClient()
  return useEngineQuery<T>(client, queryKey, query, options)
}

export function useWorkoutByDate(date: string, options?: QueryOptions): QueryState<Workout | null> {
  const query = useMemo(() => ({ kind: 'workout_by_date', date }), [date])
  return useQuery<Workout | null>(`workout_by_date:${date}`, query, options)
}

export function useWorkout(id: number, options?: QueryOptions): QueryState<Workout | null> {
  const query = useMemo(() => ({ kind: 'workout', id }), [id])
  return useQuery<Workout | null>(`workout:${id}`, query, options)
}

export function useDayNote(date: string, options?: QueryOptions): QueryState<string | null> {
  const query = useMemo(() => ({ kind: 'day_note', date }), [date])
  return useQuery<string | null>(`day_note:${date}`, query, options)
}

export function useCalendarMonth(month: string, options?: QueryOptions): QueryState<CalendarMap> {
  const query = useMemo(() => ({ kind: 'calendar', month }), [month])
  return useQuery<CalendarMap>(`calendar:${month}`, query, options)
}

export function usePlannedDates(month: string, options?: QueryOptions): QueryState<string[]> {
  const query = useMemo(() => ({ kind: 'planned_dates', month }), [month])
  return useQuery<string[]>(`planned_dates:${month}`, query, options)
}

export function useGyms(options?: QueryOptions): QueryState<Gym[]> {
  const query = useMemo(() => ({ kind: 'gyms' }), [])
  return useQuery<Gym[]>('gyms', query, options)
}

export function useSettingsQuery(options?: QueryOptions): QueryState<UserSettings> {
  const query = useMemo(() => ({ kind: 'settings' }), [])
  return useQuery<UserSettings>('settings', query, options)
}

export interface EngineCounts { workouts: number; sets: number; exercises: number }

export function useCountsQuery(options?: QueryOptions): QueryState<EngineCounts> {
  const query = useMemo(() => ({ kind: 'counts' }), [])
  return useQuery('counts', query, options)
}

export function useExercisesQuery(params?: { sort?: string; q?: string; category?: Category | null; today?: string }, options?: QueryOptions): QueryState<Exercise[]> {
  const sort = params?.sort ?? 'name'
  const q = params?.q ?? null
  const category = params?.category ?? null
  const today = params?.today ?? ''
  const query = useMemo(() => ({
    kind: 'exercises',
    sort,
    q,
    category,
    limit: 500,
    today,
  }), [sort, q, category, today])
  const key = `exercises:${sort}:${q ?? ''}:${category ?? ''}:${today}`
  return useQuery<Exercise[]>(key, query, options)
}

export function useExerciseQuery(id: number, options?: QueryOptions): QueryState<Exercise | null> {
  const query = useMemo(() => ({ kind: 'exercise', id }), [id])
  return useQuery<Exercise | null>(`exercise:${id}`, query, options)
}

export function useExerciseHistoryQuery(exerciseId: number, offset = 0, limit = 30, options?: QueryOptions): QueryState<{ total: number; items: ExerciseHistoryDay[] }> {
  const query = useMemo(() => ({ kind: 'history', exercise_id: exerciseId, offset, limit }), [exerciseId, offset, limit])
  return useQuery<{ total: number; items: ExerciseHistoryDay[] }>(`history:${exerciseId}:${offset}:${limit}`, query, options)
}

/** Every history day for an exercise, newest first (History, Graph, Records). */
export function useFullExerciseHistory(exerciseId: number, options?: QueryOptions): QueryState<{ total: number; items: ExerciseHistoryDay[] }> {
  const query = useMemo(() => ({ kind: 'history_all', exercise_id: exerciseId }), [exerciseId])
  return useQuery<{ total: number; items: ExerciseHistoryDay[] }>(`history_all:${exerciseId}`, query, options)
}
