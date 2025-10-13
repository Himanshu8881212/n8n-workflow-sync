const API_URL = 'http://localhost:3001/api';
const WS_URL = 'ws://localhost:3001';
let ws;

function connectWebSocket() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => console.log('WebSocket connected');
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
    };
    ws.onerror = (error) => console.error('WebSocket error:', error);
    ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setTimeout(connectWebSocket, 3000);
    };
}

function handleWebSocketMessage(message) {
    if (message.type === 'stats') {
        updateStats(message.data);
    } else if (message.type === 'workflows') {
        renderWorkflows(message.data);
    }
}

async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/stats`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load stats');
        updateStats(data);
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

function updateStats(stats) {
    document.getElementById('totalWorkflows').textContent = stats.totalWorkflows || 0;
    document.getElementById('lastSync').textContent = stats.lastSync
        ? new Date(stats.lastSync).toLocaleString()
        : 'Never';
    document.getElementById('status').textContent = stats.status || 'Idle';
}

async function loadWorkflows() {
    try {
        const response = await fetch(`${API_URL}/workflows`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load workflows');
        const workflows = Array.isArray(data) ? data : (data.workflows || []);
        renderWorkflows(workflows);
    } catch (error) {
        console.error('Failed to load workflows:', error);
        showToast('Failed to load workflows: ' + error.message, 'error');
    }
}

function renderWorkflows(workflows) {
    const list = document.getElementById('workflowList');
    if (!workflows || workflows.length === 0) {
        list.innerHTML = '<div class="empty-state"><h3>No workflows found</h3></div>';
        return;
    }
    list.innerHTML = workflows.map(workflow => `
        <div class="workflow-item">
            <div class="workflow-info">
                <h3>
                    ${workflow.name}
                    <span class="badge ${workflow.active ? 'active' : 'inactive'}">
                        ${workflow.active ? 'Active' : 'Inactive'}
                    </span>
                </h3>
                <p>ID: ${workflow.id} • Nodes: ${workflow.nodes?.length || 0}</p>
            </div>
            <div class="workflow-actions">
                ${workflow.active
            ? `<button class="btn-secondary" onclick="deactivateWorkflow('${workflow.id}')">Deactivate</button>`
            : `<button class="btn-secondary" onclick="activateWorkflow('${workflow.id}')">Activate</button>`
        }
                <button class="btn-danger" onclick="deleteWorkflow('${workflow.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

async function triggerPull() {
    try {
        showToast('Pulling workflows from n8n...', 'info');
        const response = await fetch(`${API_URL}/sync/pull`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Pull failed');
        showToast(`Pulled ${data.pulled || 0} workflows successfully`, 'success');
        loadWorkflows();
        loadStats();
    } catch (error) {
        showToast('Pull failed: ' + error.message, 'error');
    }
}

async function triggerPush() {
    try {
        showToast('Pushing workflows to n8n...', 'info');
        const response = await fetch(`${API_URL}/sync/push`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Push failed');
        showToast(`Pushed ${data.pushed || 0} workflows successfully`, 'success');
        loadWorkflows();
        loadStats();
    } catch (error) {
        showToast('Push failed: ' + error.message, 'error');
    }
}

async function triggerFullSync() {
    try {
        showToast('Running full sync...', 'info');
        const response = await fetch(`${API_URL}/sync/full`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Full sync failed');
        showToast('Full sync completed successfully', 'success');
        loadWorkflows();
        loadStats();
    } catch (error) {
        showToast('Full sync failed: ' + error.message, 'error');
    }
}

async function activateWorkflow(id) {
    try {
        const response = await fetch(`${API_URL}/workflows/${id}/activate`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Activation failed');
        showToast('Workflow activated', 'success');
        loadWorkflows();
    } catch (error) {
        showToast('Activation failed: ' + error.message, 'error');
    }
}

async function deactivateWorkflow(id) {
    try {
        const response = await fetch(`${API_URL}/workflows/${id}/deactivate`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Deactivation failed');
        showToast('Workflow deactivated', 'success');
        loadWorkflows();
    } catch (error) {
        showToast('Deactivation failed: ' + error.message, 'error');
    }
}

async function deleteWorkflow(id) {
    if (!confirm('Are you sure you want to delete this workflow?')) return;
    try {
        const response = await fetch(`${API_URL}/workflows/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Deletion failed');
        showToast('Workflow deleted', 'success');
        loadWorkflows();
        loadStats();
    } catch (error) {
        showToast('Deletion failed: ' + error.message, 'error');
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.className = 'toast', 3000);
}

connectWebSocket();
loadStats();
loadWorkflows();
