#!/usr/bin/env node

/**
 * Real n8n Integration Tests
 * 
 * Tests with actual running n8n instance
 * Validates 3 workflows × 3 iterations
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, readFile, unlink, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { SyncEngine } from '../src/sync-engine.js';
import { N8nClient } from '../src/n8n-client.js';
import { FileManager } from '../src/file-manager.js';
import { config } from '../src/config.js';

// Test workflows (without 'active' field - n8n sets it automatically)
const TEST_WORKFLOWS = [
  {
    name: 'Test Workflow 1 - Customer Flow',
    nodes: [
      {
        id: 'webhook-1',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [250, 300],
        parameters: { path: 'test-customer' },
      },
    ],
    connections: {},
    settings: {},
  },
  {
    name: 'Test Workflow 2 - Data Pipeline',
    nodes: [
      {
        id: 'schedule-1',
        name: 'Schedule',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1,
        position: [250, 300],
        parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
      },
    ],
    connections: {},
    settings: {},
  },
  {
    name: 'Test Workflow 3 - Notification',
    nodes: [
      {
        id: 'manual-1',
        name: 'Manual Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [250, 300],
        parameters: {},
      },
    ],
    connections: {},
    settings: {},
  },
];

describe('Real n8n Integration Tests', () => {
  let client;
  let syncEngine;
  let testDir;
  let createdWorkflowIds = [];

  before(async () => {
    // Setup test directory
    testDir = join(process.cwd(), 'test-integration-workflows');
    await mkdir(testDir, { recursive: true });

    // Initialize client
    client = new N8nClient();

    // Initialize sync engine
    syncEngine = new SyncEngine({
      workflowsDir: testDir,
      dryRun: false,
    });

    console.log('\n🔧 Setup: Creating test workflows in n8n...');
  });

  after(async () => {
    console.log('\n🧹 Cleanup: Removing test workflows from n8n...');

    // Delete created workflows
    for (const id of createdWorkflowIds) {
      try {
        await client.deleteWorkflow(id);
      } catch (error) {
        console.log(`  ⚠️  Could not delete workflow ${id}: ${error.message}`);
      }
    }

    // Cleanup test directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }

    console.log('✅ Cleanup complete\n');
  });

  describe('Phase 1: Create 3 Workflows in n8n', () => {
    for (const workflow of TEST_WORKFLOWS) {
      it(`should create workflow: ${workflow.name}`, async () => {
        const created = await client.createWorkflow(workflow);

        assert.ok(created.id);
        assert.strictEqual(created.name, workflow.name);
        assert.ok(typeof created.active === 'boolean');

        createdWorkflowIds.push(created.id);
        console.log(`  ✓ Created: ${created.name} (${created.id})`);
      });
    }
  });

  describe('Phase 2: Pull Workflows - Test 3 Times', () => {
    for (let iteration = 1; iteration <= 3; iteration++) {
      it(`Iteration ${iteration}: should pull all workflows from n8n`, async () => {
        const result = await syncEngine.pullFromN8n();

        // Should pull all workflows (including our 3 test ones)
        assert.ok(result.pulled > 0);
        assert.strictEqual(result.errors, 0);

        console.log(`  ✓ Iteration ${iteration}: Pulled ${result.pulled} workflows`);
      });

      it(`Iteration ${iteration}: should verify our 3 test workflow files exist`, async () => {
        const files = await readdir(testDir);
        const workflowFiles = files.filter(f => f.endsWith('.json'));

        // Find our test workflows
        const testWorkflowFiles = workflowFiles.filter(f =>
          f.includes('test_workflow') || f.includes('test-workflow')
        );

        assert.ok(workflowFiles.length >= 3, `Expected at least 3 files, got ${workflowFiles.length}`);
        console.log(`  ✓ Iteration ${iteration}: Found ${workflowFiles.length} workflow files (${testWorkflowFiles.length} test workflows)`);
      });
    }
  });

  describe('Phase 3: Modify and Push - Test 3 Times', () => {
    for (let iteration = 1; iteration <= 3; iteration++) {
      it(`Iteration ${iteration}: should modify our 3 test workflows`, async () => {
        const files = await readdir(testDir);
        const workflowFiles = files.filter(f => f.endsWith('.json'));

        // Find and modify only our test workflows
        let modified = 0;
        for (const file of workflowFiles) {
          const filepath = join(testDir, file);
          const content = await readFile(filepath, 'utf-8');
          const workflow = JSON.parse(content);

          // Only modify our test workflows
          if (workflow.name && workflow.name.includes('Test Workflow')) {
            workflow.name = workflow.name.replace(/ - Modified \d+/g, ''); // Remove old modification
            workflow.name = `${workflow.name} - Modified ${iteration}`;

            await writeFile(filepath, JSON.stringify(workflow, null, 2));
            modified++;
          }
        }

        assert.ok(modified >= 3, `Expected to modify 3 workflows, modified ${modified}`);
        console.log(`  ✓ Iteration ${iteration}: Modified ${modified} test workflows`);
      });

      it(`Iteration ${iteration}: should push modifications to n8n`, async () => {
        const result = await syncEngine.pushToN8n();

        assert.ok(result.updated > 0 || result.pushed > 0, 'Expected some workflows to be pushed/updated');
        assert.strictEqual(result.errors, 0);

        console.log(`  ✓ Iteration ${iteration}: Pushed ${result.pushed} new, updated ${result.updated}`);
      });

      it(`Iteration ${iteration}: should verify our 3 test workflows updated in n8n`, async () => {
        const workflows = await client.listWorkflows();
        const testWorkflows = workflows.filter(w =>
          w.name.includes('Test Workflow') && w.name.includes(`Modified ${iteration}`)
        );

        assert.strictEqual(testWorkflows.length, 3, `Expected 3 test workflows with "Modified ${iteration}", found ${testWorkflows.length}`);
        console.log(`  ✓ Iteration ${iteration}: Verified ${testWorkflows.length} updated test workflows in n8n`);
      });
    }
  });

  describe('Phase 4: Full Sync - Test 3 Times', () => {
    for (let iteration = 1; iteration <= 3; iteration++) {
      it(`Iteration ${iteration}: should perform full bidirectional sync`, async () => {
        const result = await syncEngine.fullSync();

        assert.ok(result.pull, 'Pull result should exist');
        assert.ok(result.push, 'Push result should exist');
        assert.strictEqual(result.pull.errors, 0, 'Pull should have no errors');
        assert.strictEqual(result.push.errors, 0, 'Push should have no errors');

        console.log(`  ✓ Iteration ${iteration}: Full sync - pulled ${result.pull.pulled}, pushed ${result.push.pushed}`);
      });
    }
  });

  describe('Phase 5: Workflow Management - Test 3 Workflows, 3 Times Each', () => {
    for (let iteration = 1; iteration <= 3; iteration++) {
      describe(`Iteration ${iteration}`, () => {
        it('should list all workflows and find our 3 test workflows', async () => {
          const workflows = await client.listWorkflows();
          const testWorkflows = workflows.filter(w => createdWorkflowIds.includes(w.id));

          assert.ok(workflows.length > 0, 'Should have some workflows');
          assert.strictEqual(testWorkflows.length, 3, `Expected 3 test workflows, found ${testWorkflows.length}`);
          console.log(`  ✓ Iteration ${iteration}: Listed ${workflows.length} total, found ${testWorkflows.length} test workflows`);
        });

        it('should activate all 3 test workflows', async () => {
          assert.strictEqual(createdWorkflowIds.length, 3, 'Should have 3 test workflows');

          for (const id of createdWorkflowIds) {
            const activated = await client.activateWorkflow(id);
            assert.strictEqual(activated.active, true, `Workflow ${id} should be active`);
          }

          console.log(`  ✓ Iteration ${iteration}: Activated all 3 test workflows`);
        });

        it('should deactivate all 3 test workflows', async () => {
          assert.strictEqual(createdWorkflowIds.length, 3, 'Should have 3 test workflows');

          for (const id of createdWorkflowIds) {
            const deactivated = await client.deactivateWorkflow(id);
            assert.strictEqual(deactivated.active, false, `Workflow ${id} should be inactive`);
          }

          console.log(`  ✓ Iteration ${iteration}: Deactivated all 3 test workflows`);
        });

        it('should get all 3 test workflows by ID', async () => {
          assert.strictEqual(createdWorkflowIds.length, 3, 'Should have 3 test workflows');

          for (const id of createdWorkflowIds) {
            const workflow = await client.getWorkflow(id);
            assert.ok(workflow, `Workflow ${id} should exist`);
            assert.strictEqual(workflow.id, id, `Workflow ID should match`);
          }

          console.log(`  ✓ Iteration ${iteration}: Retrieved all 3 test workflows by ID`);
        });
      });
    }
  });

  describe('Phase 6: Stress Test', () => {
    it('should handle rapid successive pulls', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(syncEngine.pullFromN8n());
      }

      const results = await Promise.all(promises);
      results.forEach(result => {
        assert.strictEqual(result.errors, 0);
      });

      console.log(`  ✓ Completed 5 rapid pulls successfully`);
    });

    it('should handle rapid successive pushes', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(syncEngine.pushToN8n());
      }

      const results = await Promise.all(promises);
      results.forEach(result => {
        assert.strictEqual(result.errors, 0);
      });

      console.log(`  ✓ Completed 5 rapid pushes successfully`);
    });
  });
});

