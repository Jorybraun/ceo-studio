#!/usr/bin/env node
/**
 * Pilot script for CEO Studio using Chrome DevTools Protocol
 * Usage: node scripts/pilot-cdp.js
 *
 * Requires the app to be running with:
 *   electron . --remote-debugging-port=9222
 */

const CDP = require('chrome-remote-interface');

async function main() {
  let client;
  try {
    client = await CDP({ port: 9222 });
    const { Page, Runtime, Input } = client;

    await Promise.all([Page.enable(), Runtime.enable()]);

    console.log('Connected to CEO Studio via CDP');

    // Example: take a screenshot
    const { data } = await Page.captureScreenshot({ format: 'png' });
    console.log('Screenshot captured (base64 length):', data.length);

    // Example: evaluate in the renderer
    const result = await Runtime.evaluate({
      expression: 'document.title',
      returnByValue: true
    });
    console.log('Page title:', result.result.value);

    // You can add click, type, navigate, etc. here using Input and Page domains

  } catch (err) {
    console.error('CDP connection failed:', err.message);
    console.log('Make sure CEO Studio is running with --remote-debugging-port=9222');
  } finally {
    if (client) await client.close();
  }
}

main();