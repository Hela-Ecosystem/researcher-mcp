import packageJson from "../../package.json"
import { SERVER_VERSION } from "../version.js"

test("advertised server version matches package.json", () => {
  expect(SERVER_VERSION).toBe(packageJson.version)
})
