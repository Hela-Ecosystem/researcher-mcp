export const MINIMUM_NODE_VERSION = "20.18.1"

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function getRuntimeRequirementError(
  version: string,
  hasGlobalFile: boolean,
): string | null {
  const current = parseVersion(version)
  const minimum = parseVersion(MINIMUM_NODE_VERSION)!
  if (!current || current[0] < 20 || (current[0] === 20 &&
      (current[1] < minimum[1] || (current[1] === minimum[1] && current[2] < minimum[2])))) {
    return `researcher-mcp requires Node.js >= ${MINIMUM_NODE_VERSION}; current version is ${version}.`
  }
  if (!hasGlobalFile) {
    return `researcher-mcp requires the global File constructor (Node.js >= ${MINIMUM_NODE_VERSION}); current version is ${version}.`
  }
  return null
}

export function assertSupportedRuntime(): void {
  const error = getRuntimeRequirementError(process.versions.node, typeof globalThis.File === "function")
  if (error) throw new Error(error)
}
