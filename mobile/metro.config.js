// Metro config for Expo + npm workspaces. Lets the Metro bundler watch and
// resolve the workspace package @lift/core which lives at ../packages/core.
//
// We do NOT disable hierarchical node_modules lookup — npm workspaces hoist
// most deps to the root but leave conflicting versions nested (e.g.
// whatwg-url-without-unicode/node_modules/webidl-conversions). Disabling
// hierarchy made those nested copies invisible to Metro and broke the bundle.
const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, "..")

const config = getDefaultConfig(projectRoot)

// Watch the whole monorepo so Metro reloads when @lift/core changes.
config.watchFolders = [workspaceRoot]

// Resolve from both the project's node_modules and the hoisted root one.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
]

// Treat the bundled FitNotes skeleton as an asset so `require()` returns an
// asset reference Metro can resolve at runtime.
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  "fitnotesdb",
]

// sql.js's asm.js build calls `require("node:fs")` and `require("node:crypto")`
// inside a Node-only branch. The branch never runs in React Native, but Metro
// still tries to resolve the specifiers statically and fails ("fs couldn't be
// found"). Redirect any `node:*` builtin to an empty stub so the bundle builds.
const NODE_BUILTIN_STUB = path.resolve(projectRoot, "node-builtin-stub.js")

// Force every `react` (and `react/*`) import to resolve to mobile's single copy
// — the version react-native's renderer is built against (19.1.0 for RN 0.81).
// npm workspaces hoist `react-native` to the repo root, where it would otherwise
// load the root's react (pinned to 19.2.4 by the web app) while mobile app code
// loads mobile/node_modules/react (19.1.0). Two React instances at runtime throw
// "Incompatible React versions: ... the React and React Native renderer". By
// anchoring resolution at mobile's react, react-native and app code share one
// instance. mobile's react pin differs from the web app's, so this nested copy
// always exists.
const reactAnchor = path.resolve(projectRoot, "node_modules/react/index.js")

// `scheduler` is part of React's runtime and must match the react version
// react-native's renderer uses. react 19.1.0 requires scheduler ^0.26.0, but the
// web app's react 19.2.4 pulls scheduler 0.27.0 to the repo root — which does NOT
// satisfy ^0.26.0. react-native nests the correct 0.26.0 under itself, so anchor
// scheduler resolution at react-native's directory (resolved dynamically so it
// survives future hoisting changes). Falls back to mobile's react if that fails.
let schedulerAnchor = reactAnchor
try {
  const rnDir = path.dirname(require.resolve("react-native/package.json", { paths: [projectRoot] }))
  schedulerAnchor = path.join(rnDir, "index.js")
} catch {}

const upstreamResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("node:")) {
    return { type: "sourceFile", filePath: NODE_BUILTIN_STUB }
  }
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return context.resolveRequest(
      { ...context, originModulePath: reactAnchor },
      moduleName,
      platform,
    )
  }
  if (moduleName === "scheduler" || moduleName.startsWith("scheduler/")) {
    return context.resolveRequest(
      { ...context, originModulePath: schedulerAnchor },
      moduleName,
      platform,
    )
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
