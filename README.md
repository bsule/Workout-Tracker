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

### TypeScript vs. Rust engine

Desktop measurements on one Apple Silicon Mac with synthetic data (10 exercises, 10 sets per workout, one workout per day). Phones are slower in absolute terms. Details and every size are in [`scripts/engine/README.md`](scripts/engine/README.md).

| Operation | Sets | TypeScript | Rust | Result |
| :--- | :--- | :--- | :--- | :--- |
| Log a set | 10,000 | 1.6 ms | 0.3 ms | 4.6x faster |
|  | 100,000 | 22.6 ms | 3.5 ms | 6.4x faster |
| Load data and build indexes | 10,000 | 10.5 ms | 1.3 ms | 7.9x faster |
|  | 100,000 | 107.8 ms | 16.7 ms | 6.5x faster |
| Recompute PRs for one exercise | 10,000 | 1.6 ms | 0.6 ms | 2.5x faster |
|  | 100,000 | 15.1 ms | 6.5 ms | 2.3x faster |
| Save the whole snapshot (JSON + gzip) | 10,000 | 37.8 ms | 11.3 ms | 3.3x faster |
|  | 100,000 | 378.2 ms | 129.8 ms | 2.9x faster |
| Read a whole snapshot (gunzip + JSON) | 10,000 | 8.6 ms | 5.8 ms | 1.5x faster |
|  | 100,000 | 81.4 ms | 59.7 ms | 1.4x faster |

What that means on the phone path, at 100,000 sets:

| | TypeScript store | Rust engine |
| :--- | :--- | :--- |
| Log a set and make it durable | 22.6 ms in memory, plus a 378 ms full-snapshot save every 30 s of activity | 4.1 ms including the SQLite commit, no periodic full save |
| Open the app | 189 ms (read snapshot + build indexes) | 95 ms (open from SQLite) |
| First launch after updating | n/a | 825 ms once, to migrate the old store |

