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

module.exports = config
