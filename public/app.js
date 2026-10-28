const API_URL = '/api';
const WS_URL = `ws://${location.host}`;

// Workflow names/ids come from n8n - never put them into HTML unescaped
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let ws;
let allWorkflows = [];
let currentFilter = 'all';
let currentTab = 'workflows';
let allAgents = [];
let agentFilter = 'all';

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
    } else if (message.type === 'agents-changed') {
        loadAgents();
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

    if (stats.n8n) {
        const link = document.getElementById('n8nLink');
        link.textContent = stats.n8n.editorUrl.replace(/^https?:\/\//, '') + (stats.n8n.env ? ` (${stats.n8n.env})` : '');
        link.href = stats.n8n.editorUrl;
        document.getElementById('n8nApi').textContent = 'API: ' + stats.n8n.apiUrl;
    }

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

    // Update button states (no implicit global `event` - it isn't guaranteed to exist)
    document.querySelectorAll('#workflowFilters .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick') === `setFilter('${filter}')`);
    });

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

// ---- tabs: the sidebar buttons act on the current tab ----
function setTab(tab) {
    currentTab = tab;
    document.getElementById('tab-workflows').classList.toggle('active', tab === 'workflows');
    document.getElementById('tab-agents').classList.toggle('active', tab === 'agents');
    document.getElementById('workflowFilters').style.display = tab === 'workflows' ? '' : 'none';
    document.getElementById('agentFilters').style.display = tab === 'agents' ? '' : 'none';
    document.getElementById('fullSyncBtn').style.display = tab === 'workflows' ? '' : 'none';
    document.getElementById('publishOption').style.display = tab === 'agents' ? '' : 'none';
    document.getElementById('searchBar').value = '';
    history.replaceState(null, '', tab === 'agents' ? '#agents' : '#');
    refresh();
}

function refresh() {
    loadStats();
    if (currentTab === 'agents') loadAgents();
    else loadWorkflows();
}

function filterList() {
    if (currentTab === 'agents') renderAgents();
    else filterWorkflows();
}

function triggerPull() {
    return currentTab === 'agents' ? pullAgents() : pullWorkflows();
}

function triggerPush() {
    return currentTab === 'agents' ? pushAgents() : pushWorkflows();
}

// ---- agents ----
async function loadAgents() {
    try {
        const response = await fetch(`${API_URL}/agents`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load agents');
        allAgents = data.agents || [];
        document.getElementById('totalAgents').textContent = allAgents.filter(a => a.inN8n).length;
        if (currentTab === 'agents') renderAgents();
    } catch (error) {
        showToast('Failed to load agents: ' + error.message, 'error');
    }
}

function setAgentFilter(filter) {
    agentFilter = filter;
    document.querySelectorAll('#agentFilters .filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('onclick') === `setAgentFilter('${filter}')`);
    });
    renderAgents();
}

function renderAgents() {
    const list = document.getElementById('workflowList');
    const term = document.getElementById('searchBar').value.toLowerCase();
    const state = (a) => (a.inN8n && a.local ? 'synced' : a.inN8n ? 'remote' : 'local');
    const agents = allAgents
        .filter(a => agentFilter === 'all' || state(a) === agentFilter)
        .filter(a => !term || a.name.toLowerCase().includes(term) || (a.id || '').toLowerCase().includes(term));
    if (!agents.length) {
        list.innerHTML = '<div class="empty">No agents found</div>';
        return;
    }
    const badge = {
        synced: '<span class="badge active">Synced</span>',
        remote: '<span class="badge remote">Only in n8n</span>',
        local: '<span class="badge local">Only local - not pushed</span>',
    };
    list.innerHTML = agents.map(a => {
        const id = esc(a.id || '');
        const s = state(a);
        return `
        <div class="workflow-item">
            <div class="workflow-info">
                <div class="workflow-name">${esc(a.name)} ${badge[s]}</div>
                <div class="workflow-meta">${id || 'new - gets an id on push'}${a.projectId ? ' • project ' + esc(a.projectId) : ''}</div>
            </div>
            <div class="workflow-actions">
                ${a.inN8n ? `<button class="btn btn-secondary" onclick="pullAgent('${id}')">${s === 'synced' ? 'Refresh' : 'Pull'}</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

async function postAgents(path, body) {
    const response = await fetch(`${API_URL}/agents/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `${path} failed`);
    return data;
}

async function pullAgent(id) {
    try {
        const r = await postAgents('pull', { select: [id] });
        showToast(`Pulled ${r.agents.length} agent(s)`, 'success');
        loadAgents();
    } catch (error) {
        showToast('Pull failed: ' + error.message, 'error');
    }
}

async function pullAgents() {
    try {
        showToast('Pulling agents from n8n...', 'info');
        // Nothing tracked yet -> pull every agent n8n has
        const all = !allAgents.some(a => a.local);
        const r = await postAgents('pull', { all });
        const kept = r.kept.length ? ` (${r.kept.length} local-only kept)` : '';
        showToast(`Pulled ${r.agents.length} agent(s)${kept}`, 'success');
        loadAgents();
    } catch (error) {
        showToast('Pull failed: ' + error.message, 'error');
    }
}

async function pushAgents() {
    const publish = document.getElementById('publishAgents').checked;
    const local = allAgents.filter(a => a.local).length;
    if (!local) return showToast('No agents in the local folder - pull or create one first', 'error');
    if (!confirm(`Push ${local} agent(s) from the agents folder to n8n${publish ? ' and publish them' : ''}?`)) return;
    try {
        showToast('Pushing agents to n8n...', 'info');
        const r = await postAgents('push', { publish });
        const count = (st) => r.agents.filter(a => a.status === st).length;
        showToast(`Agents: ${count('created')} created, ${count('updated')} updated, ${count('skipped')} skipped`, 'success');
        loadAgents();
    } catch (error) {
        showToast('Push failed: ' + error.message, 'error');
    }
}

// ---- workflows ----
async function pullWorkflows() {
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

async function pushWorkflows() {
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
loadAgents();
if (location.hash === '#agents') setTab('agents');
