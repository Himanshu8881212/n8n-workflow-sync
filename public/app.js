const API_URL = '/api';
const WS_URL = `ws://${location.host}`;

// Workflow names/ids come from n8n - never put them into HTML unescaped
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let ws;
let allWorkflows = [];
let currentFilter = 'all';

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
    console.log('WebSocket message received:', message);

    if (message.type === 'stats') {
        console.log('Updating stats with:', message.data);
        updateStats(message.data);
    } else if (message.type === 'workflows') {
        allWorkflows = message.data;
        filterWorkflows();
    } else if (message.type === 'sync-complete') {
        console.log('Sync complete:', message.operation);
        loadStats();
        loadWorkflows();
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
    console.log('updateStats called with:', stats);

    // Update total workflows
    if (stats.totalWorkflows !== undefined) {
        document.getElementById('totalWorkflows').textContent = stats.totalWorkflows;
    }

    // Update last sync
    if (stats.lastSync) {
        document.getElementById('lastSync').textContent = new Date(stats.lastSync).toLocaleString();
    }

    // Update status - this is the key part!
    if (stats.status) {
        const statusText = stats.status.charAt(0).toUpperCase() + stats.status.slice(1);
        document.getElementById('status').textContent = statusText;
        console.log('Status updated to:', statusText);
    }
}

async function loadWorkflows() {
    try {
        const response = await fetch(`${API_URL}/workflows`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load workflows');
        allWorkflows = Array.isArray(data) ? data : (data.workflows || []);
        renderWorkflows(allWorkflows);
    } catch (error) {
        console.error('Failed to load workflows:', error);
        showToast('Failed to load workflows: ' + error.message, 'error');
    }
}

function setFilter(filter) {
    currentFilter = filter;

    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    filterWorkflows();
}

function filterWorkflows() {
    const searchTerm = document.getElementById('searchBar').value.toLowerCase();

    let filtered = allWorkflows;

    // Apply status filter
    if (currentFilter === 'active') {
        filtered = filtered.filter(w => w.active === true);
    } else if (currentFilter === 'inactive') {
        filtered = filtered.filter(w => w.active === false);
    }

    // Apply search filter
    if (searchTerm) {
        filtered = filtered.filter(w =>
            w.name.toLowerCase().includes(searchTerm) ||
            w.id.toLowerCase().includes(searchTerm)
        );
    }

    renderWorkflows(filtered);
}

function hasTriggerNode(workflow) {
    if (!workflow.nodes || !Array.isArray(workflow.nodes)) return false;

    // Check if workflow has any trigger, webhook, or poller nodes
    const triggerTypes = ['trigger', 'webhook', 'poll'];
    return workflow.nodes.some(node => {
        const nodeType = (node.type || '').toLowerCase();
        return triggerTypes.some(type => nodeType.includes(type));
    });
}

function renderWorkflows(workflows) {
    const list = document.getElementById('workflowList');
    if (!workflows || workflows.length === 0) {
        list.innerHTML = '<div class="empty">No workflows found</div>';
        return;
    }
    list.innerHTML = workflows.map(workflow => {
        const hasTrigger = hasTriggerNode(workflow);
        const id = esc(workflow.id);

        return `
        <div class="workflow-item">
            <div class="workflow-info">
                <div class="workflow-name">
                    ${esc(workflow.name)}
                    ${hasTrigger
                ? `<span class="badge ${workflow.active ? 'active' : 'inactive'}">
                            ${workflow.active ? 'Active' : 'Inactive'}
                           </span>`
                : `<span class="badge manual">Manual</span>`
            }
                </div>
                <div class="workflow-meta">${id} • ${workflow.nodes?.length || 0} nodes</div>
            </div>
            <div class="workflow-actions">
                ${hasTrigger
                ? (workflow.active
                    ? `<button class="btn btn-secondary" onclick="deactivateWorkflow('${id}')">Deactivate</button>`
                    : `<button class="btn btn-secondary" onclick="activateWorkflow('${id}')">Activate</button>`)
                : `<span style="color: #666; font-size: 11px;">Manual execution only</span>`
            }
                <button class="btn btn-secondary" onclick="deleteWorkflow('${id}')">Delete</button>
            </div>
        </div>
        `;
    }).join('');
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
        const response = await fetch(`${API_URL}/workflows/${encodeURIComponent(id)}/activate`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) {
            // Extract meaningful error message
            let errorMsg = data.error || 'Activation failed';
            if (errorMsg.includes('no node to start the workflow')) {
                errorMsg = 'Workflow needs a trigger, webhook, or poller node to be activated';
            }
            throw new Error(errorMsg);
        }
        showToast('Workflow activated', 'success');
        loadWorkflows();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deactivateWorkflow(id) {
    try {
        const response = await fetch(`${API_URL}/workflows/${encodeURIComponent(id)}/deactivate`, { method: 'POST' });
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
        const response = await fetch(`${API_URL}/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

// Initialize app
connectWebSocket();
loadStats();
loadWorkflows();
