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
const upstreamResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("node:")) {
    return { type: "sourceFile", filePath: NODE_BUILTIN_STUB }
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
