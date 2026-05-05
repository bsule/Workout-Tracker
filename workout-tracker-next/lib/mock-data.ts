import type { WorkoutSplit } from "@/types"

export const mockWorkouts: WorkoutSplit[] = [
  {
    id: 1,
    name: "Bench Press",
    sessions: [
      {
        id: 101,
        date: "2025-03-01T09:00:00Z",
        sets: [
          { weight: 135, reps: 10 },
          { weight: 155, reps: 8 },
          { weight: 175, reps: 6 },
        ],
        maxWeight: 213.4,
      },
      {
        id: 102,
        date: "2025-03-08T09:00:00Z",
        sets: [
          { weight: 145, reps: 10 },
          { weight: 165, reps: 8 },
          { weight: 185, reps: 5 },
        ],
        maxWeight: 219.8,
      },
      {
        id: 103,
        date: "2025-03-15T09:00:00Z",
        sets: [
          { weight: 155, reps: 10 },
          { weight: 175, reps: 7 },
          { weight: 195, reps: 5 },
        ],
        maxWeight: 231.5,
      },
      {
        id: 104,
        date: "2025-03-22T09:00:00Z",
        sets: [
          { weight: 165, reps: 8 },
          { weight: 185, reps: 6 },
          { weight: 205, reps: 4 },
        ],
        maxWeight: 235.7,
      },
      {
        id: 105,
        date: "2025-03-29T09:00:00Z",
        sets: [
          { weight: 175, reps: 8 },
          { weight: 195, reps: 5 },
          { weight: 215, reps: 3 },
        ],
        maxWeight: 241.2,
      },
      {
        id: 106,
        date: "2025-04-05T09:00:00Z",
        sets: [
          { weight: 185, reps: 6 },
          { weight: 205, reps: 4 },
          { weight: 225, reps: 3 },
        ],
        maxWeight: 252.6,
      },
      {
        id: 107,
        date: "2025-04-12T09:00:00Z",
        sets: [
          { weight: 185, reps: 8 },
          { weight: 210, reps: 5 },
          { weight: 230, reps: 3 },
        ],
        maxWeight: 258.1,
      },
    ],
  },
  {
    id: 2,
    name: "Squat",
    sessions: [
      {
        id: 201,
        date: "2025-03-02T09:00:00Z",
        sets: [
          { weight: 185, reps: 10 },
          { weight: 225, reps: 8 },
          { weight: 255, reps: 5 },
        ],
        maxWeight: 302.7,
      },
      {
        id: 202,
        date: "2025-03-09T09:00:00Z",
        sets: [
          { weight: 205, reps: 8 },
          { weight: 245, reps: 6 },
          { weight: 275, reps: 4 },
        ],
        maxWeight: 315.4,
      },
      {
        id: 203,
        date: "2025-03-16T09:00:00Z",
        sets: [
          { weight: 225, reps: 8 },
          { weight: 265, reps: 5 },
          { weight: 295, reps: 3 },
        ],
        maxWeight: 330.9,
      },
      {
        id: 204,
        date: "2025-03-23T09:00:00Z",
        sets: [
          { weight: 235, reps: 8 },
          { weight: 275, reps: 5 },
          { weight: 305, reps: 3 },
        ],
        maxWeight: 341.8,
      },
      {
        id: 205,
        date: "2025-03-30T09:00:00Z",
        sets: [
          { weight: 245, reps: 6 },
          { weight: 285, reps: 4 },
          { weight: 315, reps: 2 },
        ],
        maxWeight: 347.2,
      },
      {
        id: 206,
        date: "2025-04-06T09:00:00Z",
        sets: [
          { weight: 255, reps: 6 },
          { weight: 295, reps: 4 },
          { weight: 325, reps: 2 },
        ],
        maxWeight: 358.5,
      },
      {
        id: 207,
        date: "2025-04-13T09:00:00Z",
        sets: [
          { weight: 265, reps: 5 },
          { weight: 305, reps: 3 },
          { weight: 335, reps: 2 },
        ],
        maxWeight: 369.3,
      },
    ],
  },
  {
    id: 3,
    name: "Deadlift",
    sessions: [
      {
        id: 301,
        date: "2025-03-03T09:00:00Z",
        sets: [
          { weight: 225, reps: 8 },
          { weight: 275, reps: 5 },
          { weight: 315, reps: 3 },
        ],
        maxWeight: 352.9,
      },
      {
        id: 302,
        date: "2025-03-10T09:00:00Z",
        sets: [
          { weight: 245, reps: 6 },
          { weight: 295, reps: 4 },
          { weight: 335, reps: 2 },
        ],
        maxWeight: 369.4,
      },
      {
        id: 303,
        date: "2025-03-17T09:00:00Z",
        sets: [
          { weight: 265, reps: 5 },
          { weight: 315, reps: 3 },
          { weight: 355, reps: 2 },
        ],
        maxWeight: 391.1,
      },
      {
        id: 304,
        date: "2025-03-24T09:00:00Z",
        sets: [
          { weight: 275, reps: 5 },
          { weight: 325, reps: 3 },
          { weight: 365, reps: 1 },
        ],
        maxWeight: 365.0,
      },
      {
        id: 305,
        date: "2025-03-31T09:00:00Z",
        sets: [
          { weight: 285, reps: 5 },
          { weight: 335, reps: 3 },
          { weight: 375, reps: 2 },
        ],
        maxWeight: 413.7,
      },
      {
        id: 306,
        date: "2025-04-07T09:00:00Z",
        sets: [
          { weight: 295, reps: 5 },
          { weight: 345, reps: 3 },
          { weight: 385, reps: 2 },
        ],
        maxWeight: 424.6,
      },
      {
        id: 307,
        date: "2025-04-14T09:00:00Z",
        sets: [
          { weight: 315, reps: 4 },
          { weight: 365, reps: 2 },
          { weight: 405, reps: 1 },
        ],
        maxWeight: 405.0,
      },
    ],
  },
  {
    id: 4,
    name: "Overhead Press",
    sessions: [
      {
        id: 401,
        date: "2025-03-04T09:00:00Z",
        sets: [
          { weight: 95, reps: 10 },
          { weight: 115, reps: 8 },
          { weight: 135, reps: 5 },
        ],
        maxWeight: 160.2,
      },
      {
        id: 402,
        date: "2025-03-11T09:00:00Z",
        sets: [
          { weight: 100, reps: 10 },
          { weight: 120, reps: 7 },
          { weight: 140, reps: 4 },
        ],
        maxWeight: 163.8,
      },
      {
        id: 403,
        date: "2025-03-18T09:00:00Z",
        sets: [
          { weight: 105, reps: 8 },
          { weight: 125, reps: 6 },
          { weight: 145, reps: 4 },
        ],
        maxWeight: 169.4,
      },
      {
        id: 404,
        date: "2025-03-25T09:00:00Z",
        sets: [
          { weight: 110, reps: 8 },
          { weight: 130, reps: 5 },
          { weight: 150, reps: 3 },
        ],
        maxWeight: 168.0,
      },
      {
        id: 405,
        date: "2025-04-01T09:00:00Z",
        sets: [
          { weight: 115, reps: 6 },
          { weight: 135, reps: 4 },
          { weight: 155, reps: 3 },
        ],
        maxWeight: 173.7,
      },
      {
        id: 406,
        date: "2025-04-08T09:00:00Z",
        sets: [
          { weight: 120, reps: 6 },
          { weight: 140, reps: 4 },
          { weight: 160, reps: 2 },
        ],
        maxWeight: 176.3,
      },
      {
        id: 407,
        date: "2025-04-15T09:00:00Z",
        sets: [
          { weight: 125, reps: 5 },
          { weight: 145, reps: 3 },
          { weight: 165, reps: 2 },
        ],
        maxWeight: 181.9,
      },
    ],
  },
  {
    id: 5,
    name: "Barbell Row",
    sessions: [
      {
        id: 501,
        date: "2025-03-05T09:00:00Z",
        sets: [
          { weight: 135, reps: 10 },
          { weight: 165, reps: 8 },
          { weight: 185, reps: 6 },
        ],
        maxWeight: 225.7,
      },
      {
        id: 502,
        date: "2025-03-12T09:00:00Z",
        sets: [
          { weight: 145, reps: 10 },
          { weight: 175, reps: 7 },
          { weight: 195, reps: 5 },
        ],
        maxWeight: 231.4,
      },
      {
        id: 503,
        date: "2025-03-19T09:00:00Z",
        sets: [
          { weight: 155, reps: 8 },
          { weight: 185, reps: 6 },
          { weight: 205, reps: 4 },
        ],
        maxWeight: 235.2,
      },
      {
        id: 504,
        date: "2025-03-26T09:00:00Z",
        sets: [
          { weight: 165, reps: 8 },
          { weight: 195, reps: 5 },
          { weight: 215, reps: 4 },
        ],
        maxWeight: 246.8,
      },
      {
        id: 505,
        date: "2025-04-02T09:00:00Z",
        sets: [
          { weight: 175, reps: 6 },
          { weight: 205, reps: 4 },
          { weight: 225, reps: 3 },
        ],
        maxWeight: 252.2,
      },
      {
        id: 506,
        date: "2025-04-09T09:00:00Z",
        sets: [
          { weight: 185, reps: 6 },
          { weight: 215, reps: 4 },
          { weight: 235, reps: 3 },
        ],
        maxWeight: 263.4,
      },
      {
        id: 507,
        date: "2025-04-16T09:00:00Z",
        sets: [
          { weight: 195, reps: 6 },
          { weight: 225, reps: 4 },
          { weight: 245, reps: 2 },
        ],
        maxWeight: 270.1,
      },
    ],
  },
]

export function getWorkoutById(id: number): WorkoutSplit | undefined {
  return mockWorkouts.find((w) => w.id === id)
}

export function getChartData(workoutId: number) {
  const workout = getWorkoutById(workoutId)
  if (!workout) return []
  return workout.sessions.slice(-7).map((s, i) => ({
    session: i + 1,
    maxWeight: Math.round(s.maxWeight * 10) / 10,
    date: new Date(s.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }))
}

export function calculateOneRepMax(weight: number, reps: number): number {
  if (reps === 1) return weight
  return weight / (1.0278 - 0.0278 * reps)
}
