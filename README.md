# Lift

A mobile-first workout tracker inspired by [FitNotes](http://www.fitnotesapp.com/). Log your sets, plan the days ahead, and watch your lifts go up. It's built for iPhone and Android, with a web app alongside, and your data lives on your device first. The cloud is only there to sync between them.

## What it does

- **Log sets fast.** Weight and reps, or distance and time for cardio. A "since last set" timer counts your rest, and on a phone it also shows on the Lock Screen and in the Dynamic Island (iOS) or as a notification (Android).
- **See how you're doing.** Estimated 1RM trends, PRs, top weight for each rep count, and what you did last time, right next to the set you're logging.
- **Plan ahead.** Build routines on the calendar, or have an AI model draft a plan with your own API key (Anthropic, OpenAI, Gemini, or DeepSeek).
- **Take notes.** On a day, one exercise, or a single set.
- **Bring your FitNotes history.** Import a FitNotes CSV export, and export back out as CSV, a FitNotes `.fitnotesdb` file, or JSON whenever you like.
- **Keep your data safe.** Everything saves on the device and works offline. Cloud sync runs automatically when you open the app and a sync is due, and you can also sync manually from Settings. The phone and web apps each keep local restore points (the previous save, a day-old copy, and an undo copy before you replace your data) in case something goes wrong.

## Install it on your phone

The app isn't in the App Store or Play Store. You build it yourself with one command, for iPhone or Android. See **[docs/install.md](docs/install.md)**.

## Run it on your computer

To run the app locally, test it, or deploy it, see **[docs/development.md](docs/development.md)**.

## Engine architecture and performance

On mobile, workout data lives in a Rust engine (SQLite on the device, called through an Expo module). It owns storage, queries, PRs, imports, exports, restore points and sync. The web app still runs on the TypeScript store; a WebAssembly build of the same engine exists but is switched off until browser migration is done.

More detailed everyday-operation and PR timings, concentrated-history stress
cases and worker-encoding results are in [docs/benchmarks.md](docs/benchmarks.md).

### TypeScript vs. Rust engine

Desktop medians at **100,000 sets**, measured on the development Apple Silicon
Mac with the same verified synthetic snapshot (10 exercises, 10 sets per workout).
These are desktop measurements; they exclude React rendering and the mobile bridge.

| Operation | TypeScript, in memory | Rust, in memory | Rust native, including commit/encoding |
| :--- | ---: | ---: | ---: |
| Add set | 22.955 ms | 0.513 ms | 1.060 ms |
| Edit set | 19.455 ms | 3.014 ms | 3.415 ms |
| Delete set | 19.572 ms | 3.092 ms | 3.289 ms |
| Predict PR | 0.968 ms | 0.435 ms | 0.294 ms |
| Recompute all PRs | 157.882 ms | 33.685 ms | 34.792 ms |
| Load workout day | 0.012 ms | 0.038 ms | 0.053 ms |

Rust native mutations include SQLite commit and receipt encoding. TypeScript's
in-memory timings exclude its periodic snapshot save. Query timings include
Rust DTO/JSON encoding, while TypeScript returns store objects. Opening persisted
data with a warm OS file cache took **99.278 ms** for the TypeScript snapshot and
**41.457 ms** for Rust SQLite, including indexes in both cases.

### Deletion optimization

| Total sets | Previous Rust, durable | Optimized Rust, durable | Speedup |
| :--- | ---: | ---: | ---: |
| 100,000 | 24.492 ms | 3.289 ms | 7.4× |
| 250,000 | 67.842 ms | 9.649 ms | 7.0× |

These delete the most recently appended logged set. Additional benchmarks cover
middle deletions, record promotion and planned sets; regression tests check PR
flags, indexes, SQLite reopen behavior and survivor ordering. See
[the complete results and reproduction commands](docs/benchmarks.md).

Worker encoding reduced the measured 100,000-set main-thread stall from
**374.64 ms to 38.45 ms**, with longer total encoding time. This diagnostic runs
the browser worker source in a Node worker thread; browser and phone timings vary.
