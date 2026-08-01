/**
 * Shared Metro configuration for the Juniper Expo apps (npm-workspaces
 * monorepo + the pdfmake resolver stub).
 *
 * Usage, in an app's metro.config.js:
 *
 *   const { getDefaultConfig } = require('expo/metro-config');
 *   const { withJuniperMetro } = require('@juniper/medplum-rn/metro');
 *   module.exports = withJuniperMetro(getDefaultConfig(__dirname), __dirname);
 */
const path = require('path');

const PDFMAKE_STUB = path.resolve(__dirname, 'pdfmake-stub.js');

function withJuniperMetro(config, projectRoot) {
  const workspaceRoot = path.resolve(projectRoot, '../..');

  // Watch the whole workspace so @juniper/* packages hot-reload…
  config.watchFolders = Array.from(
    new Set([...(config.watchFolders ?? []), workspaceRoot])
  );
  // …and resolve modules from both the app and the hoisted root node_modules.
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ];

  // pdfmake: optional peer of @medplum/core, browser/Node-oriented, breaks
  // Metro if it ever gets resolved. Neither app makes PDFs — stub it.
  const previousResolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'pdfmake' || moduleName.startsWith('pdfmake/')) {
      return { filePath: PDFMAKE_STUB, type: 'sourceFile' };
    }
    if (previousResolveRequest) {
      return previousResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };

  return config;
}

module.exports = { withJuniperMetro };
