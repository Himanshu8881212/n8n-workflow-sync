/**
 * Mock API responses for testing
 */

export const mockWorkflowsList = {
  data: [
    {
      id: 'workflow-1',
      name: 'Test Workflow 1',
      active: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'workflow-2',
      name: 'Test Workflow 2',
      active: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
  ],
  nextCursor: null,
};

export const mockWorkflowDetail = {
  id: 'workflow-1',
  name: 'Test Workflow 1',
  active: true,
  nodes: [
    {
      parameters: {},
      id: 'node-1',
      name: 'Start',
      type: 'n8n-nodes-base.start',
      typeVersion: 1,
      position: [250, 300],
    },
  ],
  connections: {},
  settings: {},
  staticData: null,
  tags: [],
  pinData: {},
  versionId: '1',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

export const mockCreateWorkflowResponse = {
  id: 'new-workflow-123',
  name: 'New Workflow',
  active: false,
  nodes: [],
  connections: {},
  settings: {},
  staticData: null,
  tags: [],
  pinData: {},
  versionId: '1',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

export const mockUpdateWorkflowResponse = {
  id: 'workflow-1',
  name: 'Updated Workflow',
  active: true,
  nodes: [],
  connections: {},
  settings: {},
  staticData: null,
  tags: [],
  pinData: {},
  versionId: '2',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
};

export const mockErrorResponse = {
  message: 'Workflow not found',
  code: 404,
};

