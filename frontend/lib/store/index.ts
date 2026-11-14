import * as coreStore from "@lift/core/store"
import { WEB_ENGINE_ENABLED, getWebSessions } from "@/lib/engine/webEngine"
import type { WorkoutApi } from "@lift/engine-client/workout-api"

export * from "@lift/core/store"

function getActiveEngineApi(): WorkoutApi | null {
  if (typeof window === "undefined" || !WEB_ENGINE_ENABLED) return null
  const sessions = getWebSessions()
  return sessions.session?.api ?? null
}

export async function deleteWorkout(id: number): Promise<void> {
  const api = getActiveEngineApi()
  if (api) {
    await api.deleteWorkout(id)
  } else {
    coreStore.deleteWorkout(id)
  }
}

export async function deleteSets(ids: number[]): Promise<void> {
  const api = getActiveEngineApi()
  if (api) {
    await api.deleteSets(ids)
  } else {
    coreStore.deleteSets(ids)
  }
}

export async function deleteWorkoutExercise(workoutId: number, weId: number): Promise<void> {
  const api = getActiveEngineApi()
  if (api) {
    await api.removeExerciseFromWorkout(workoutId, weId)
  } else {
    coreStore.localApi.removeExerciseFromWorkout(workoutId, weId)
  }
}

export async function startPlannedWorkout(id: number) {
  const api = getActiveEngineApi()
  if (api) {
    return api.startPlannedWorkout(id)
  }
  return coreStore.startPlannedWorkout(id)
}

export async function finishWorkout(id: number) {
  const api = getActiveEngineApi()
  if (api) {
    return api.finishWorkout(id)
  }
  return coreStore.finishWorkout(id)
}

export const localApi: typeof coreStore.localApi = {
  ...coreStore.localApi,

  updateSettings(patch) {
    const api = getActiveEngineApi()
    return api ? api.updateSettings(patch) : coreStore.localApi.updateSettings(patch)
  },

  listExercises(params) {
    const api = getActiveEngineApi()
    return api ? api.listExercises(params) : coreStore.localApi.listExercises(params)
  },

  createExercise(body) {
    const api = getActiveEngineApi()
    return api ? api.createExercise(body) : coreStore.localApi.createExercise(body)
  },

  patchExercise(id, patch) {
    const api = getActiveEngineApi()
    return api ? (api.patchExercise(id, patch) as any) : coreStore.localApi.patchExercise(id, patch)
  },

  deleteExercise(id) {
    const api = getActiveEngineApi()
    return api ? api.deleteExercise(id) : coreStore.localApi.deleteExercise(id)
  },

  getWorkout(id) {
    const api = getActiveEngineApi()
    return api ? api.getWorkout(id) : coreStore.localApi.getWorkout(id)
  },

  createWorkout(date) {
    const api = getActiveEngineApi()
    return api ? api.createWorkout(date) : coreStore.localApi.createWorkout(date)
  },

  patchWorkout(id, patch) {
    const api = getActiveEngineApi()
    return api ? api.patchWorkout(id, patch) : coreStore.localApi.patchWorkout(id, patch)
  },

  addExerciseToWorkout(workoutId, exerciseId) {
    const api = getActiveEngineApi()
    return api ? api.addExerciseToWorkout(workoutId, exerciseId) : coreStore.localApi.addExerciseToWorkout(workoutId, exerciseId)
  },

  removeExerciseFromWorkout(workoutId, weId) {
    const api = getActiveEngineApi()
    return api ? api.removeExerciseFromWorkout(workoutId, weId) : coreStore.localApi.removeExerciseFromWorkout(workoutId, weId)
  },

  copyFromWorkout(targetId, sourceId, withSets) {
    const api = getActiveEngineApi()
    return api ? api.copyFromWorkout(targetId, sourceId, withSets) : coreStore.localApi.copyFromWorkout(targetId, sourceId, withSets)
  },

  addSet(weId, set) {
    const api = getActiveEngineApi()
    return api ? api.addSet(weId, set) : coreStore.localApi.addSet(weId, set)
  },

  addPlannedSet(weId, set) {
    const api = getActiveEngineApi()
    return api ? api.addPlannedSet(weId, set) : coreStore.localApi.addPlannedSet(weId, set)
  },

  updateSet(setId, patch) {
    const api = getActiveEngineApi()
    return api ? api.updateSet(setId, patch) : coreStore.localApi.updateSet(setId, patch)
  },

  deleteSet(setId) {
    const api = getActiveEngineApi()
    return api ? api.deleteSet(setId) : coreStore.localApi.deleteSet(setId)
  },

  listGyms() {
    const api = getActiveEngineApi()
    return api ? api.listGyms() : coreStore.localApi.listGyms()
  },

  createGym(name) {
    const api = getActiveEngineApi()
    return api ? api.createGym(name) : coreStore.localApi.createGym(name)
  },

  deleteGym(id) {
    const api = getActiveEngineApi()
    return api ? api.deleteGym(id) : coreStore.localApi.deleteGym(id)
  },

  renameGym(id, name) {
    const api = getActiveEngineApi()
    return api ? api.renameGym(id, name) : coreStore.localApi.renameGym(id, name)
  },

  setDayNote(date, text) {
    const api = getActiveEngineApi()
    return api ? api.setDayNote(date, text) : coreStore.localApi.setDayNote(date, text)
  },

  async setWorkoutNote(workoutId, text) {
    const api = getActiveEngineApi()
    if (api) {
      await api.setWorkoutNote(workoutId, text)
    } else {
      await coreStore.localApi.setWorkoutNote(workoutId, text)
    }
  },

  setExerciseNote(weId, text) {
    const api = getActiveEngineApi()
    return api ? api.setExerciseNote(weId, text) : coreStore.localApi.setExerciseNote(weId, text)
  },

  recomputePrs() {
    const api = getActiveEngineApi()
    return api ? api.recomputePrs() : coreStore.localApi.recomputePrs()
  },
}
