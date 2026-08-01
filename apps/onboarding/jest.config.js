/**
 * Pure-logic tests only (preferences client, FHIR submit builder, token-lint).
 * Node environment, ts-jest — no native modules, no jest-expo, nothing rendered.
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
          module: 'commonjs',
          moduleResolution: 'node',
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
