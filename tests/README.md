# Tests

This directory contains all tests for the n8n workflow sync service.

## Structure

```
tests/
├── unit/              # Unit tests for individual modules
├── integration/       # Integration tests for end-to-end scenarios
├── fixtures/          # Test data and mock workflows
└── README.md          # This file
```

## Running Tests

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Writing Tests

### Unit Tests

Unit tests should test individual functions and modules in isolation.

Example:
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { myFunction } from '../src/my-module.js';

describe('myFunction', () => {
  it('should return expected value', () => {
    const result = myFunction('input');
    assert.strictEqual(result, 'expected');
  });
});
```

### Integration Tests

Integration tests should test complete workflows and interactions between modules.

Example:
```javascript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { SyncEngine } from '../src/sync-engine.js';

describe('SyncEngine Integration', () => {
  let syncEngine;

  before(async () => {
    syncEngine = new SyncEngine('./test-workflows');
    await syncEngine.initialize();
  });

  it('should sync workflows successfully', async () => {
    const result = await syncEngine.sync();
    assert.ok(result.success);
  });

  after(async () => {
    await syncEngine.cleanup();
  });
});
```

## Test Coverage

We aim for >70% code coverage. Run `npm run test:coverage` to see current coverage.

## Fixtures

Test fixtures are located in `tests/fixtures/` and include:
- Sample workflow JSON files
- Mock API responses
- Test configuration files

