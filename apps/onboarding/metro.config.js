const { getDefaultConfig } = require('expo/metro-config');
const { withJuniperMetro } = require('@juniper/medplum-rn/metro');

// Monorepo watch folders + node_modules paths, and the pdfmake resolver stub
// (@medplum/core's optional peer, a known Metro hazard — see docs/PLAN.md).
module.exports = withJuniperMetro(getDefaultConfig(__dirname), __dirname);
