import electron from "electron"
import { initDatabase, closeDatabase, getDbPath } from "./database.js"
import { configureLocalAdministrator } from "./services/local-auth-service.js"
import { createStorageConfig, writeStorageConfig } from "./services/storage-config-service.js"

const { app } = electron

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`
  const argument = process.argv.find((value) => value.startsWith(prefix))
  return argument?.slice(prefix.length)
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm")) {
    console.log("Local SQLite demo dataset plan:")
    console.log("  administrator: Demo Admin (demo.admin)")
    console.log("  demo data: weapons, ammunition, accessories, shipments, customers, invoice, payment")
    console.log("Preview only. Re-run with --confirm to seed the local SQLite database.")
    app.quit()
    return
  }

  await app.whenReady()
  try {
    await initDatabase()
    const administrator = configureLocalAdministrator({
      storeName: argumentValue("store-name") ?? "Armory Store Demo",
      adminName: argumentValue("admin-name") ?? process.env.SEED_ADMIN_NAME ?? "Demo Admin",
      adminUsername: argumentValue("admin-username") ?? process.env.SEED_ADMIN_USERNAME ?? "demo.admin",
      adminPassword: argumentValue("admin-password") ?? process.env.SEED_ADMIN_PASSWORD ?? "Demo1234!",
    })
    writeStorageConfig(createStorageConfig("sqlite"))
    console.log("Local SQLite seed completed and verified.")
    console.log(`Database: ${getDbPath()}`)
    console.log(`Sign in with: ${administrator.identifier}`)
  } finally {
    closeDatabase()
    app.quit()
  }
}

main().catch((error: unknown) => {
  console.error(`Local SQLite seed failed: ${error instanceof Error ? error.message : String(error)}`)
  app.quit()
  process.exitCode = 1
})
