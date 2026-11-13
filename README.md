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

## Engine Architecture & Performance

Workout storage, queries, and data invariants are powered by a shared Rust engine compiled natively for mobile (iOS & Android via Expo modules) and via WebAssembly for web workers.

### Performance Benchmarks (vs. Legacy TypeScript Engine)

Measurements compare the legacy TypeScript engine against the release-mode Rust engine across synthetic datasets (desktop diagnostics; see [`scripts/engine/README.md`](scripts/engine/README.md)):

| Operation | Scale (Sets) | TypeScript Baseline (mean) | Rust Engine (mean) | Improvement |
| :--- | :--- | :--- | :--- | :--- |
| **Index Hydration & Clones** | 1,000 | **1.08 ms** | **0.09 ms** | **~12x faster** |
| | 10,000 | **9.69 ms** | **0.83 ms** | **~11.6x faster** |
| | 50,000 | **50.2 ms** | **4.47 ms** | **~11.2x faster** |
| | 100,000 | **104.5 ms** | **10.9 ms** | **~9.6x faster** |
| **Snapshot Serialization** | 1,000 | **4.16 ms** | **0.26 ms** | **~16x faster** |
| | 10,000 | **36.8 ms** | **2.85 ms** | **~13x faster** |
| | 50,000 | **183.7 ms** | **15.1 ms** | **~12.1x faster** |
| | 100,000 | **362.5 ms** | **28.6 ms** | **~12.6x faster** |
| **Set Mutation (`addSet`)** | 100,000 | **20.8 ms** | **21.5 ms** | **Parity** (strict schema validation) |
| **Snapshot Parse** | 100,000 | **72.1 ms** | **77.4 ms** | **Parity** |
