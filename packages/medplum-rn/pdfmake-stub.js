/**
 * Metro resolver stub for `pdfmake`.
 *
 * `@medplum/core` declares pdfmake as an (optional) peer dependency for its
 * PDF-creation helpers. pdfmake is browser/Node-oriented and is a known Metro
 * bundling hazard (see docs/PLAN.md, "Medplum in React Native"). Neither
 * Juniper app generates PDFs, so Metro resolves the module name to this empty
 * stub via the resolver in metro.js.
 *
 * If anyone ever calls a Medplum PDF API in an app, they will get an obvious
 * runtime error from this stub rather than a cryptic bundling failure.
 */
module.exports = {};
