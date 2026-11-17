async function main() {
  try {
    const { assertSupportedRuntime } = await import('./src/runtimeGuard.js');
    assertSupportedRuntime();
    const { default: SimpleResearchMCPServer } = await import('./research-server.js');
    const server = new SimpleResearchMCPServer();
    await server.run();
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();
