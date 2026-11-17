import { getRuntimeRequirementError, MINIMUM_NODE_VERSION } from "../runtimeGuard.js"

describe("runtime compatibility guard", () => {
  test("rejects Node versions below the declared minimum", () => {
    expect(getRuntimeRequirementError("20.18.0", true)).toContain(`Node.js >= ${MINIMUM_NODE_VERSION}`)
  })

  test("rejects a missing global File constructor", () => {
    expect(getRuntimeRequirementError("20.18.1", false)).toContain("global File constructor")
  })

  test("accepts a supported Node runtime with File", () => {
    expect(getRuntimeRequirementError("22.0.0", true)).toBeNull()
  })
})
