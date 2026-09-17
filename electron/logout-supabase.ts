import electron from "electron"
import { clearStorageConfig } from "./services/storage-config-service.js"
import { readStoredConnection } from "./services/store-installation-service.js"
import { removeSecureAuthValue } from "./services/secure-auth-storage-service.js"

const { app } = electron

async function main(): Promise<void> {
  await app.whenReady()

  const connection = readStoredConnection()
  if (connection) {
    removeSecureAuthValue(`weapon-store-auth-${connection.installationId}`)
  }
  clearStorageConfig()

  console.log("Supabase session cleared locally.")
  console.log("The provider selection was cleared. Start the application again to return to setup.")
  app.quit()
}

main().catch((error: unknown) => {
  console.error(`Supabase logout failed: ${error instanceof Error ? error.message : String(error)}`)
  app.quit()
  process.exitCode = 1
})
