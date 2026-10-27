// Code for the "Build Reply" node of hello-webhook.json
const { name = 'stranger' } = $json.body ?? {};

return [{ json: { greeting: `Hello, ${name}!`, at: new Date().toISOString() } }];
