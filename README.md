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

## Rust engine

### How Lift uses Rust

On mobile, a Rust engine owns all workout data. It keeps your data in a SQLite database, a single file in the app's private storage on the phone, and it handles saving, queries, PRs, imports, exports, restore points and sync. Each edit is saved to the database as you make it. The React Native screens only show data and send commands to the engine.

The web app can run the same engine, compiled to WebAssembly in a background worker, when `NEXT_PUBLIC_LIFT_WEB_ENGINE=1` is set. Otherwise it uses the TypeScript store. Both read and write the same snapshot format, so sync, backups and the Cloudflare Worker work the same either way.

### Moving from TypeScript to Rust

Lift started with all of its data logic in TypeScript (`@lift/core`), shared by the phone and web apps. Your whole history was held in memory as one object, and about every 30 seconds the app compressed all of it and saved it as one file. This slowed down as histories grew: each change to a set rebuilt indexes and rescanned PR history, and on the phone the compression ran on the same thread that draws the screen.

The mobile app now uses the Rust engine instead. The first time an updated app opens, the engine moves the old TypeScript save files into its database, so no history is lost.

Desktop medians at **100,000 sets** on an Apple Silicon Mac, using the same synthetic history (10 exercises, 10 sets per workout). They exclude React rendering and the mobile bridge.

| Operation | TypeScript (in memory) | Rust (with SQLite commit) | Speed increase |
| :--- | ---: | ---: | :--- |
| Add set | 22.955 ms | 1.060 ms | 21.7× faster |
| Delete set | 19.572 ms | 3.289 ms | 6.0× faster |
| Edit set | 19.455 ms | 3.415 ms | 5.7× faster |
| Recompute all PRs | 157.882 ms | 34.792 ms | 4.5× faster |
| Predict PR | 0.968 ms | 0.294 ms | 3.3× faster |
| Load workout day | 0.012 ms | 0.033 ms | Slower (adds ~0.02 ms to encode the result for the app) |

The Rust times include saving to disk; the TypeScript times leave out its 30-second save. Opening saved data took **99 ms** for the TypeScript store and **41 ms** for Rust SQLite. Full results and reproduction commands are in [docs/benchmarks.md](docs/benchmarks.md).
