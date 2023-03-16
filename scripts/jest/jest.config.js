const { defaults } = require('jest-config');

module.exports = {
  ...defaults,
  rootDir: process.cwd(),
  // modulePathIgnorePatterns: [],
  moduleDirectories: [
    // 对于React ReactDOM
    'dist/node_modules',
    // 对于第三方依赖
    ...defaults.moduleDirectories,
  ],
  testEnvironment: 'jsdom',
};
