/**
 * Pure-logic tests only (timeline grouping, contract lint tests).
 * Node environment, ts-jest — no native modules, nothing rendered.
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          // TS5011: tests live in __tests__ but import from ../src.
          rootDir: '.',
          module: 'node16',
          // TS6 deprecates node10 resolution; node16 is the forward-compatible
          // pairing for the commonjs output ts-jest needs.
          moduleResolution: 'node16',
          jsx: 'react-jsx',
          esModuleInterop: true,
          resolveJsonModule: true,
          strict: true,
          skipLibCheck: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
