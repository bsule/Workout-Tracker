/**
 * Build a FitNotes iOS-compatible .fitnotesdb (zip-of-SQLite) from the local
 * IndexedDB snapshot. **Everything in this module is lazy-loaded** — sql.js
 * (~700KB WASM) only enters the bundle when the user clicks "Export as
 * FitNotes DB", so daily-driver app speed is unaffected.
 *
 * Encoding gotchas (verified against a real FitNotes export):
 *   - Dates: float seconds since 2001-01-01 UTC ("Apple ref date").
 *   - Weights: int hundredths in BOTH ZWEIGHTKG and ZWEIGHTLBS.
 *   - Distance: int hundredths of the original display unit + ZDISTANCEUNITINT.
 *   - UUIDs split into two signed int64 columns.
 *   - ZINDEX / ZWORKOUTEXERCISEINDEX are int64 fractional-indexing keys.
 *   - ZRIR=-999999.0, ZRPE=-1.0 are sentinels for "not set".
 *   - Z_METADATA / Z_MODELCACHE blobs MUST stay byte-identical to the
 *     skeleton — Core Data hashes the model cache.
 */

import type { Snapshot } from "@/lib/store/schema"

const SKELETON_URL = "/data/fitnotes_skeleton.fitnotesdb"

const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1)
const KG_TO_LB = 2.20462262
const RIR_NULL = -999999.0
const RPE_NULL = -1.0

// ZKINDINT mapping (verified against the test DB).
const KIND_INT: Record<string, number> = {
  weight_reps: 3,
  bodyweight_reps: 6,
  time_only: 9,
  distance_time: 12,
}

// (unit_int, meters_per_unit). mi=1, ft=4 verified; km=2, m=3 inferred.
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

function appleTs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return (ms - APPLE_EPOCH_MS) / 1000
}

function midnightUtcTs(date: string): number {
  // date is YYYY-MM-DD in local user terms; FitNotes stores as midnight UTC.
  const [y, m, d] = date.split("-").map(Number)
  const ms = Date.UTC(y, (m ?? 1) - 1, d ?? 1)
  return (ms - APPLE_EPOCH_MS) / 1000
}

function uuidHalves(): [bigint, bigint] {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // RFC 4122 v4 marker bits — match what uuid4() produces.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  // High and low halves as signed int64 (big-endian).
  let hi = 0n
  let lo = 0n
  for (let i = 0; i < 8; i++) hi = (hi << 8n) | BigInt(bytes[i])
  for (let i = 8; i < 16; i++) lo = (lo << 8n) | BigInt(bytes[i])
  // Convert unsigned-style bigints to signed int64 representation.
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
  // Fractional-style int64 keys. We use BigInt because regular JS numbers
  // can't represent int64 cleanly. SQLite stores them losslessly.
  private weNext: bigint
  private setNext = new Map<string, bigint>()
  private readonly step = 1n << 30n

  constructor() {
    // Big negative base so we don't collide with FitNotes' own inserts.
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

import type { Database, BindParams } from "sql.js"

/** Public entry. Returns the bytes of a complete .fitnotesdb (zip). */
export async function buildFitnotesDb(snap: Snapshot): Promise<Uint8Array> {
  // Lazy imports — these only land in the bundle the moment the user exports.
  const [{ default: initSqlJs }, fflate] = await Promise.all([
    import("sql.js"),
    import("fflate"),
  ])

  // sql.js fetches its WASM separately. We self-host it in /public/data/
  // so export works offline (no CDN dep).
  const SQL = await initSqlJs({
    locateFile: (file: string) => `/data/${file}`,
  })

  // Fetch and unzip the skeleton.
  const skelResp = await fetch(SKELETON_URL)
  if (!skelResp.ok) {
    throw new Error(
      `Failed to load FitNotes skeleton from ${SKELETON_URL} (HTTP ${skelResp.status})`
    )
  }
  const skelZipBytes = new Uint8Array(await skelResp.arrayBuffer())
  const unzipped = fflate.unzipSync(skelZipBytes)
  const inner = unzipped["database.fitnotesdb"]
  if (!inner) {
    throw new Error('Skeleton zip is missing "database.fitnotesdb" entry')
  }

  // Open in sql.js, populate, export bytes.
  const db: Database = new SQL.Database(inner)
  populate(db, snap)
  const dbBytes = db.export()
  db.close()

  // Re-zip into a single-entry archive.
  const outZip = fflate.zipSync(
    { "database.fitnotesdb": dbBytes },
    { level: 6 }
  )
  return outZip
}

function populate(db: Database, snap: Snapshot): void {
  // sql.js's BindParams is SqlValue[] = (string | number | null | Uint8Array
  // | bigint)[]; our params are all of those, so an unknown[] cast is safe.
  const run = (sql: string, params: unknown[]) => {
    db.run(sql, params as BindParams)
  }
  // --- preload: name (lower) → Z_PK from skeleton's stock catalog.
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

  // Z_PK counters per entity, seeded from current Z_MAX in Z_PRIMARYKEY.
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

  // --- index local-store snapshot for fast lookup.
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
    if (s.is_planned) continue // skip planned/target sets
    const arr = setsByWe.get(s.workout_exercise_id) ?? []
    arr.push(s)
    setsByWe.set(s.workout_exercise_id, arr)
  }

  const nowTs = (Date.now() - APPLE_EPOCH_MS) / 1000
  const indexer = new IndexGen()

  // Iterate workouts in date order for stable PK assignment.
  const workouts = [...snap.workouts].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id
  )

  for (const w of workouts) {
    const wes = (wesByWorkout.get(w.id) ?? []).slice().sort(
      (a, b) => a.order - b.order || a.id - b.id
    )
    if (wes.length === 0) continue // skip empty workouts (no calendar marker)

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
      if (!ex) continue // dangling reference — skip
      const exKey = ex.name.toLowerCase()
      let exPk = exerciseLookup.get(exKey)
      if (exPk == null) {
        // Custom exercise not in the catalog — INSERT it.
        exPk = nextPk("Exercise")
        const catPk = categoryLookup.get((ex.category || "").toLowerCase()) ?? null
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
            null,
            midnightUtcTs(w.date),
            RIR_NULL,
            RPE_NULL,
            s.note || null,
          ]
        )
      }
    }
  }

  // Persist the new Z_PK counters.
  for (const [name, val] of counters) {
    run("UPDATE Z_PRIMARYKEY SET Z_MAX = ? WHERE Z_NAME = ?", [val, name])
  }
}

/** Trigger a download of the .fitnotesdb file in the browser. */
export async function downloadFitnotesDb(snap: Snapshot): Promise<void> {
  const bytes = await buildFitnotesDb(snap)
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" })
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("T", "-")
    .slice(0, 15)
  const filename = `FitNotes-${ts}.fitnotesdb`
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
