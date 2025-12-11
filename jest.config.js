module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Coverage configuration
  collectCoverageFrom: [
    'scripts/**/*.js',
    'server.js',
    '!node_modules/**',
    '!coverage/**'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Test match patterns
  testMatch: [
    '**/testing/**/*.test.js',
    '**/testing/**/*.spec.js'
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/testing/setup.js'],
  
  // Module paths
  moduleDirectories: ['node_modules', 'scripts'],
  
  // Verbose output
  verbose: true,
  
  // Timeout
  testTimeout: 10000
};
