/**
 * Build a FitNotes iOS-compatible .fitnotesdb (zip-of-SQLite) from a Snapshot.
 *
 * This module is platform-agnostic — the host (web/mobile) injects sql.js
 * and the skeleton bytes, since loading those is platform-specific.
 *
 * Encoding (verified against a real FitNotes export):
 *   - Dates: float seconds since 2001-01-01 UTC ("Apple ref date").
 *   - Weights: int hundredths in BOTH ZWEIGHTKG and ZWEIGHTLBS.
 *   - Distance: int hundredths of the original display unit + ZDISTANCEUNITINT.
 *   - UUIDs split into two signed int64 columns.
 *   - ZINDEX / ZWORKOUTEXERCISEINDEX are int64 fractional-indexing keys.
 *   - ZRIR=-999999.0, ZRPE=-1.0 are sentinels for "not set".
 *   - Z_METADATA / Z_MODELCACHE blobs MUST stay byte-identical to the
 *     skeleton — Core Data hashes the model cache.
 */

import { unzipSync, zipSync } from "fflate"
import type { Snapshot } from "../store/schema"

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)
const KG_TO_LB = 2.20462262
const RIR_NULL = -999999.0
const RPE_NULL = -1.0

const KIND_INT: Record<string, number> = {
  weight_reps: 3,
  bodyweight_reps: 6,
  time_only: 9,
  distance_time: 12,
}

const DIST_UNIT: Record<string, [number, number]> = {
  mi: [1, 1609.344],
  km: [2, 1000.0],
  m: [3, 1.0],
  ft: [4, 0.3048],
}

const ENT_EXERCISE = 2
const ENT_WORKOUT = 23
const ENT_WORKOUT_EXERCISE = 24
const ENT_WORKOUT_SET = 26

export interface SqlJsDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>
  run(sql: string, params?: unknown[]): unknown
  export(): Uint8Array
  close(): void
}

export interface SqlJsModule {
  Database: new (data?: Uint8Array) => SqlJsDatabase
}

export interface BuildFitnotesDbOptions {
  /** Complete FitNotes skeleton (.fitnotesdb zip bytes). */
  skeletonBytes: Uint8Array
  /** Initialised sql.js module — host loads with the right wasm/asm setup. */
  SQL: SqlJsModule
}

function appleTs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return (ms - APPLE_EPOCH_MS) / 1000
}

function midnightUtcTs(date: string): number {
  const [y, m, d] = date.split("-").map(Number)
  const ms = Date.UTC(y, (m ?? 1) - 1, d ?? 1)
  return (ms - APPLE_EPOCH_MS) / 1000
}

function uuidHalves(): [bigint, bigint] {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  let hi = 0n
  let lo = 0n
  for (let i = 0; i < 8; i++) hi = (hi << 8n) | BigInt(bytes[i])
  for (let i = 8; i < 16; i++) lo = (lo << 8n) | BigInt(bytes[i])
  const TWO64 = 1n << 64n
  const SIGN64 = 1n << 63n
  if (hi >= SIGN64) hi -= TWO64
  if (lo >= SIGN64) lo -= TWO64
  return [hi, lo]
}

function kgInt(kg: number | null): number {
  return kg == null ? 0 : Math.round(kg * 100)
}
function lbInt(kg: number | null): number {
  return kg == null ? 0 : Math.round(kg * KG_TO_LB * 100)
}

function distancePieces(
  distanceM: number | null,
  unit: string
): [number, number] {
  if (distanceM == null || distanceM <= 0) return [0, 0]
  const info = DIST_UNIT[unit?.toLowerCase()] ?? DIST_UNIT.m
  const [code, mult] = info
  const amount = distanceM / mult
  return [Math.round(amount * 100), code]
}

class IndexGen {
  private weNext: bigint
  private setNext = new Map<string, bigint>()
  private readonly step = 1n << 30n

  constructor() {
    this.weNext = -(1n << 62n)
  }

  nextWe(): bigint {
    const v = this.weNext
    this.weNext += this.step
    return v
  }

  nextSet(weIndex: bigint): bigint {
    const key = weIndex.toString()
    const cur = this.setNext.get(key) ?? weIndex + 1n
    this.setNext.set(key, cur + this.step)
    return cur
  }
}

/** Build a complete .fitnotesdb (zip of one SQLite file) from a snapshot. */
export async function buildFitnotesDb(
  snap: Snapshot,
  { skeletonBytes, SQL }: BuildFitnotesDbOptions
): Promise<Uint8Array> {
  const unzipped = unzipSync(skeletonBytes)
  const inner = unzipped["database.fitnotesdb"]
  if (!inner) {
    throw new Error('Skeleton zip is missing "database.fitnotesdb" entry')
  }

  const db = new SQL.Database(inner)
  populate(db, snap)
  const dbBytes = db.export()
  db.close()

  return zipSync({ "database.fitnotesdb": dbBytes }, { level: 6 })
}

function populate(db: SqlJsDatabase, snap: Snapshot): void {
  const run = (sql: string, params: unknown[]) => {
    db.run(sql, params)
  }

  const exerciseLookup = new Map<string, number>()
  {
    const rows = db.exec("SELECT Z_PK, ZNAME FROM ZEXERCISE")
    if (rows.length) {
      for (const r of rows[0].values) {
        const pk = Number(r[0])
        const name = String(r[1] ?? "")
        if (name) exerciseLookup.set(name.toLowerCase(), pk)
      }
    }
  }
  const categoryLookup = new Map<string, number>()
  {
    const rows = db.exec("SELECT Z_PK, ZNAME FROM ZEXERCISECATEGORY")
    if (rows.length) {
      for (const r of rows[0].values) {
        const pk = Number(r[0])
        const name = String(r[1] ?? "")
        if (name) categoryLookup.set(name.toLowerCase(), pk)
      }
    }
  }

  const counters = new Map<string, number>()
  {
    const rows = db.exec("SELECT Z_NAME, Z_MAX FROM Z_PRIMARYKEY")
    if (rows.length) {
      for (const r of rows[0].values) {
        counters.set(String(r[0]), Number(r[1]))
      }
    }
  }
  const nextPk = (entity: string): number => {
    const v = (counters.get(entity) ?? 0) + 1
    counters.set(entity, v)
    return v
  }

  const exById = new Map<number, Snapshot["exercises"][number]>()
  for (const e of snap.exercises) exById.set(e.id, e)
  const wesByWorkout = new Map<number, Snapshot["workout_exercises"]>()
  for (const we of snap.workout_exercises) {
    const arr = wesByWorkout.get(we.workout_id) ?? []
    arr.push(we)
    wesByWorkout.set(we.workout_id, arr)
  }
  const setsByWe = new Map<number, Snapshot["sets"]>()
  for (const s of snap.sets) {
    if (s.is_planned) continue
    const arr = setsByWe.get(s.workout_exercise_id) ?? []
    arr.push(s)
    setsByWe.set(s.workout_exercise_id, arr)
  }

  const nowTs = (Date.now() - APPLE_EPOCH_MS) / 1000
  const indexer = new IndexGen()

  const workouts = [...snap.workouts].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id
  )

  for (const w of workouts) {
    const wes = (wesByWorkout.get(w.id) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id - b.id)
    if (wes.length === 0) continue

    const woPk = nextPk("Workout")
    const [woHi, woLo] = uuidHalves()
    run(
      `INSERT INTO ZWORKOUT (Z_PK, Z_ENT, Z_OPT, ZHKUPDATECOUNTER,
        ZHKWORKOUTACTIVITYTYPERAW, ZUUID1, ZUUID2, ZIMPORTEDDATE,
        ZDATE, ZSTARTTIME, ZSTARTEDWATCHWORKOUTATTIMESTAMP, ZSTOPTIME,
        ZNOTES, ZHKUUID) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        woPk,
        ENT_WORKOUT,
        1,
        0,
        -1,
        woHi,
        woLo,
        null,
        midnightUtcTs(w.date),
        appleTs(w.started_at),
        null,
        appleTs(w.finished_at),
        w.notes || null,
        null,
      ]
    )

    for (const we of wes) {
      const ex = exById.get(we.exercise_id)
      if (!ex) continue
      const exKey = ex.name.toLowerCase()
      let exPk = exerciseLookup.get(exKey)
      if (exPk == null) {
        exPk = nextPk("Exercise")
        const catPk =
          categoryLookup.get((ex.category || "").toLowerCase()) ?? null
        const [eHi, eLo] = uuidHalves()
        run(
          `INSERT INTO ZEXERCISE (
            Z_PK, Z_ENT, Z_OPT,
            ZDEFAULTGRAPHQUERYRAW, ZDEFAULTGRAPHTIMEPERIODRAW,
            ZDOUBLEWEIGHTFORVOLUME, ZEXCLUDEFROMSTATS, ZFAVORITED,
            ZHKWORKOUTACTIVITYTYPERAW, ZINPUTTIMEFORMATRAW,
            ZKINDINT, ZRESTTIME, ZUNITINT, ZUSERHIDDEN, ZUUID1,
            ZUUID2, ZWEIGHTINCREMENTKG, ZWEIGHTINCREMENTLBS,
            ZWORKOUTCOUNT, ZCATEGORY, ZDEFAULTPLATEPROFILE,
            ZTRAININGMAXHEADENTRY, ZCREATEDAT, ZMOSTRECENTDATE,
            ZPERCENTSCALCROUNDINGKG, ZPERCENTSCALCROUNDINGLB,
            ZREPMAXCALCCACHE, ZREPMAXUSERDEFINED, ZNAME, ZNAMEKEYRAW,
            ZNOTES
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            exPk,
            ENT_EXERCISE,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            KIND_INT[ex.kind] ?? 3,
            -1,
            0,
            0,
            eHi,
            eLo,
            0,
            0,
            0,
            catPk,
            null,
            null,
            nowTs,
            null,
            0.0,
            0.0,
            0.0,
            0.0,
            ex.name,
            null,
            null,
          ]
        )
        exerciseLookup.set(exKey, exPk)
      }

      const wePk = nextPk("WorkoutExercise")
      const weIndex = indexer.nextWe()
      const [weHi, weLo] = uuidHalves()
      run(
        `INSERT INTO ZWORKOUTEXERCISE (Z_PK, Z_ENT, Z_OPT, ZINDEX,
          ZRESTTIME, ZUNITINT, ZUUID1, ZUUID2, ZWEIGHTINCREMENTKG,
          ZWEIGHTINCREMENTLBS, ZEXERCISE, ZSUPERSET, ZWORKOUT, ZDATE)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          wePk,
          ENT_WORKOUT_EXERCISE,
          1,
          weIndex,
          -1,
          0,
          weHi,
          weLo,
          0,
          0,
          exPk,
          null,
          woPk,
          midnightUtcTs(w.date),
        ]
      )

      const sets = (setsByWe.get(we.id) ?? [])
        .slice()
        .sort((a, b) => a.order - b.order || a.id - b.id)
      for (const s of sets) {
        const setPk = nextPk("WorkoutSet")
        const setIndex = indexer.nextSet(weIndex)
        const [sHi, sLo] = uuidHalves()
        const [distAmount, distUnitInt] = distancePieces(
          s.distance_m,
          s.distance_unit_display
        )
        run(
          `INSERT INTO ZWORKOUTSET (Z_PK, Z_ENT, Z_OPT,
            ZDISTANCEAMOUNT, ZDISTANCEUNITINT, ZINDEX,
            ZISALLTIMERECORD, ZISCOMPLETED, ZISWORKSET, ZREPS,
            ZRESTTIME, ZTIME, ZUUID1, ZUUID2, ZWEIGHTKG,
            ZWEIGHTLBS, ZWORKOUTEXERCISEINDEX, ZEXERCISE,
            ZWORKOUT, ZWORKOUTEXERCISE, ZCOMPLETEDAT, ZDATE,
            ZRIR, ZRPE, ZNOTES) VALUES
            (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            setPk,
            ENT_WORKOUT_SET,
            1,
            distAmount,
            distUnitInt,
            setIndex,
            s.is_pr ? 1 : 0,
            1,
            1,
            s.reps ?? 0,
            -1,
            s.time_seconds ?? 0,
            sHi,
            sLo,
            kgInt(s.weight),
            lbInt(s.weight),
            weIndex,
            exPk,
            woPk,
            wePk,
            appleTs(s.created_at) ?? midnightUtcTs(w.date),
            midnightUtcTs(w.date),
            RIR_NULL,
            RPE_NULL,
            s.note || null,
          ]
        )
      }
    }
  }

  for (const [name, val] of counters) {
    run("UPDATE Z_PRIMARYKEY SET Z_MAX = ? WHERE Z_NAME = ?", [val, name])
  }
}

/** Filename like FitNotes-20260509-014212.fitnotesdb. */
export function timestampedFitnotesDbName(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .slice(0, 15)
  return `FitNotes-${ts}.fitnotesdb`
}
