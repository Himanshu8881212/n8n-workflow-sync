import { N8nClient } from './src/n8n-client.js';

async function cleanup() {
  const client = new N8nClient();

  console.log('🧹 Cleaning up n8n workflows...\n');

  const workflows = await client.listWorkflows();
  console.log(`Found ${workflows.length} workflows to delete\n`);

  for (const wf of workflows) {
    await client.deleteWorkflow(wf.id);
    console.log(`✓ Deleted: ${wf.name} (ID: ${wf.id})`);
  }

  console.log(`\n✅ All ${workflows.length} workflows deleted!`);
}

cleanup().catch(console.error);

