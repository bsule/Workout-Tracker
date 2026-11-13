# Mobile build performance

The previous GitHub-hosted Release runs at `32fac7d` provide the baseline:

- iOS: [run 43382328414](https://github.com/bsule/Workout-Tracker/actions/runs/43382328414), successful: **20m 53s** for the job, including **2m 29s** preparing Rust and **14m 19s** in Xcode.
- Android: [run 43382328221](https://github.com/bsule/Workout-Tracker/actions/runs/43382328221), failed at R8 after compiling all four template ABIs. Its APK step took 23m 45s; this is a failed-build timing, not a successful release baseline.

The updated workflows reduce unnecessary work, cache compiler/dependency outputs,
and reuse exact finished artifacts. Mobile-only npm installation avoids unrelated
web/Worker dependencies (667 packages in the isolated local check; its 5-second
install used the development machine's warm npm cache, not a clean CI runner). Android now builds the two ABIs actually
provided by Rust, with an optional single-ABI input. iOS prepares only device Rust
for IPAs. See [development](development.md#phone-builds) for inputs and cache scope.

Measure three cases separately:

1. An initial compile with no matching caches.
2. A second dispatch on the same commit with `force_rebuild=true`, reusing compiler
   caches but rebuilding the app.
3. A normal second dispatch, reusing the exact app artifact when its fingerprint
   matches. This measures reuse/upload overhead, not compiler speed.

Record overall job time and the Rust, Xcode/Gradle and cache restore/save steps.
Runner contention, downloads and cache upload costs vary, so one run is diagnostic.
The workflows retain Xcode's build timing summary and Gradle's cache/job summary.
No paid runner is enabled by default; faster runner selection is available for
repositories with an appropriate runner configured. Precompiled iOS React Native
and Expo modules were already enabled by the installed SDK, so this change claims
no additional gain from enabling them.
