# Testing Documentation

## Overview
This project uses Jest as the testing framework with Supertest for API testing and JSDOM for DOM testing.

## Running Tests

### Install Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Only Unit Tests
```bash
npm run test:unit
```

### Run Only Integration Tests
```bash
npm run test:integration
```

### Generate Coverage Report
```bash
npm test -- --coverage
```

## Test Structure

```
testing/
├── setup.js                          # Test configuration and global setup
├── unit/                             # Unit tests
│   ├── google-calendar.test.js      # Google Calendar API tests
│   └── parsing.test.js              # Excel parsing and data transformation tests
└── integration/                      # Integration tests
    └── server.test.js               # API endpoint tests
```

## What's Being Tested

### Unit Tests

#### 1. Google Calendar Manager (`google-calendar.test.js`)
- OAuth2 initialization
- Authorization URL generation
- Token exchange and management
- Event creation from course data
- Date/time parsing (AM/PM handling, timezone)
- Recurrence rule generation (weekly meetings)
- Calendar list retrieval

#### 2. Parsing Functions (`parsing.test.js`)
- Course code extraction from titles
- Meeting pattern parsing (Monday/Wednesday format)
- Time parsing (12-hour to 24-hour conversion)
- Course validation (registration status)
- Excel to JSON conversion
- ICS file format generation
- Text escaping for calendar formats

### Integration Tests

#### Server API (`server.test.js`)
- Health check endpoint
- Google OAuth flow (URL generation, callback handling)
- Authentication status checking
- Calendar list retrieval with session
- Event creation with authentication
- Error handling for unauthenticated requests

## Coverage Goals

The project aims for:
- **70% branch coverage** - All major code paths tested
- **70% function coverage** - All functions have at least basic tests
- **70% line coverage** - Most code lines executed during tests
- **70% statement coverage** - Most statements tested

## Test Data

### Sample Course Object
```javascript
{
  title: 'CSCI 101 - Introduction to Computer Science',
  instructor: 'Dr. Smith',
  location: 'Room 101',
  days: 'Monday/Wednesday',
  time: '9:00 AM',
  endTime: '10:15 AM',
  startDate: '2025-01-13',
  endDate: '2025-05-02'
}
```

## Mocking Strategy

### Google APIs
- `googleapis` module is mocked to avoid real API calls
- Mock responses simulate successful authentication and event creation
- Error cases are tested with mock rejections

### File System
- `fs-extra` is mocked to avoid actual file operations
- Token storage/retrieval is simulated in memory

### Sessions
- Express sessions are configured in-memory for testing
- No need for Redis or other session stores

## Writing New Tests

### Unit Test Template
```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup code
  });

  it('should do something specific', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Integration Test Template
```javascript
describe('GET /api/endpoint', () => {
  it('should return expected response', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .query({ param: 'value' });
    
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      key: 'value'
    });
  });
});
```

## Common Issues

### Mock Not Working
If a mock isn't being applied:
1. Ensure mock is defined before importing the module
2. Use `jest.clearAllMocks()` in `beforeEach`
3. Check that mock path matches actual import path

### Timeout Errors
If tests timeout:
1. Increase timeout in jest.config.js
2. Use `done` callback for async tests
3. Ensure promises are properly awaited

### Coverage Not Updating
If coverage isn't accurate:
1. Clear Jest cache: `npx jest --clearCache`
2. Check coverage exclusions in jest.config.js
3. Ensure all test files match the pattern in testMatch

## CI/CD Integration

Add to your CI pipeline:
```yaml
- name: Run tests
  run: npm test

- name: Check coverage
  run: npm test -- --coverage --coverageThreshold='{"global":{"branches":70,"functions":70,"lines":70,"statements":70}}'
```

## Future Test Ideas

1. **Frontend E2E Tests** - Use Playwright or Cypress for full browser testing
2. **Load Tests** - Test API under high concurrent requests
3. **Security Tests** - Test OAuth flow security, CSRF protection
4. **Accessibility Tests** - Use axe-core for a11y validation
5. **Visual Regression** - Screenshot comparison for UI changes
