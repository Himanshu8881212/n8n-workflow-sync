/**
 * Offline workflow checks that catch the usual hand-written / AI-written
 * mistakes before n8n ever sees the file. n8n itself accepts almost anything
 * on create/update and only fails at activation or run time.
 *
 * @module validator
 */

/**
 * Nodes that let a workflow be activated (published). Manual Trigger is a
 * trigger but can't be activated; Execute Workflow Trigger can (n8n 2.x
 * requires sub-workflows to be published before their callers).
 */
export function isAutoTrigger(node) {
  const type = String(node?.type || '');
  if (/manualTrigger$/i.test(type)) return false;
  return /trigger$/i.test(type) || /\.webhook$/i.test(type) || /formTrigger|chatTrigger/i.test(type);
}

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateWorkflow(wf) {
  const errors = [];
  const warnings = [];

  if (!wf || typeof wf !== 'object') return { errors: ['not an object'], warnings };
  if (typeof wf.name !== 'string' || !wf.name.trim()) errors.push('`name` is missing');
  if (!Array.isArray(wf.nodes)) errors.push('`nodes` must be an array');
  if (!wf.connections || typeof wf.connections !== 'object' || Array.isArray(wf.connections)) {
    errors.push('`connections` must be an object');
  }
  if (errors.length) return { errors, warnings };

  const names = new Set();
  wf.nodes.forEach((node, i) => {
    const label = node?.name ? `node "${node.name}"` : `node #${i}`;
    if (!node?.name) errors.push(`${label}: missing \`name\``);
    else if (names.has(node.name)) errors.push(`${label}: duplicate node name (names must be unique)`);
    else names.add(node.name);
    if (!node?.type) errors.push(`${label}: missing \`type\``);
    if (node?.typeVersion === undefined) errors.push(`${label}: missing \`typeVersion\``);
    if (!Array.isArray(node?.position) || node.position.length !== 2) {
      errors.push(`${label}: \`position\` must be [x, y]`);
    }
    if (node?.parameters !== undefined && (typeof node.parameters !== 'object' || node.parameters === null)) {
      errors.push(`${label}: \`parameters\` must be an object`);
    }
    for (const [credType, ref] of Object.entries(node?.credentials || {})) {
      if (!ref || typeof ref !== 'object' || (!ref.id && !ref.name)) {
        errors.push(`${label}: credential "${credType}" needs { "id", "name" }`);
      }
    }
    if (/\.webhook$/i.test(node?.type || '') && !node?.parameters?.path) {
      warnings.push(`${label}: webhook has no \`parameters.path\``);
    }
  });

  for (const [source, outputs] of Object.entries(wf.connections)) {
    if (!names.has(source)) {
      errors.push(`connections: source "${source}" is not a node name (connections are keyed by node name, not id)`);
    }
    for (const [type, branches] of Object.entries(outputs || {})) {
      if (!Array.isArray(branches)) {
        errors.push(`connections["${source}"].${type} must be an array of arrays`);
        continue;
      }
      for (const branch of branches) {
        for (const conn of branch || []) {
          if (!names.has(conn?.node)) errors.push(`connections: "${source}" → "${conn?.node}" — target is not a node name`);
        }
      }
    }
  }

  if (!wf.nodes.some(isAutoTrigger)) {
    warnings.push('no automatic trigger node (Webhook, Schedule, app trigger) — it can be pushed but not activated');
  }

  return { errors, warnings };
}
