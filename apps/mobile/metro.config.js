const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo setup per Expo's docs (https://docs.expo.dev/guides/monorepos/):
// watch the whole workspace so changes to @engineeringos/types are picked up,
// and search both the app's own node_modules and the workspace root's so
// pnpm-hoisted transitive deps (like @babel/runtime) resolve correctly.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
