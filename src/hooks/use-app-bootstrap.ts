import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { AUTHENTICATED_USER_NOT_LINKED } from "@/lib/db"
import { signOutActiveDatabase } from "@/hooks/use-database-auth"

export function isSupabaseConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLocaleLowerCase()
  return normalized.includes("could not reach the supabase project")
    || normalized.includes("failed to fetch")
    || normalized.includes("network")
    || normalized.includes("offline")
    || normalized.includes("connection")
    || normalized.includes("econnrefused")
    || normalized.includes("timed out")
}

export function useAppBootstrap(enabled = true) {
  const ready = useStore((s: { ready: boolean }) => s.ready)
  const bootstrap = useStore((s: { bootstrap: () => Promise<void> }) => s.bootstrap)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (enabled && !ready) {
      const perf = typeof performance !== "undefined" ? performance : null
      perf?.mark("boot:hook-bootstrap:request")
      bootstrap().catch(async (e) => {
        if (e instanceof Error && e.message === AUTHENTICATED_USER_NOT_LINKED) {
          await signOutActiveDatabase()
          setError(null)
          return
        }
        if (isSupabaseConnectionError(e)) {
          try {
            await signOutActiveDatabase({ localOnly: true })
          } catch (signOutError) {
            console.error("Could not clear the Supabase session after a connection failure:", signOutError)
          }
        }
        setError(e instanceof Error ? e.message : "Failed to initialize database")
      })
    }
  }, [enabled, ready, bootstrap])

  useEffect(() => {
    if (!ready) return
    const perf = typeof performance !== "undefined" ? performance : null
    perf?.mark("boot:ready")
    const navEntry = perf?.getEntriesByType("navigation")?.[0]
    if (navEntry) {
      const toReadyMs = navEntry.duration
      console.info(`[perf] boot:ready navigationDuration=${toReadyMs.toFixed(1)}ms`)
    }
  }, [ready])

  return { ready, error }
}
