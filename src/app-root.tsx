import { useEffect, useState } from "react"
import { useStore } from "@/lib/store"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import type { AppProps } from "./App.tsx"
import { useDatabaseAuth } from "@/hooks/use-database-auth"
import { AuthScreen } from "@/components/auth-screen"
import { useSupabaseSync } from "@/hooks/use-supabase-sync"
import { signOutActiveDatabase } from "@/hooks/use-database-auth"
import { translations } from "@/lib/i18n/translations"
import { FirstRunSetupScreen } from "@/components/first-run-setup-screen"
import { configureSupabaseClient } from "@/lib/supabase/client"
import { configureDatabaseProvider } from "@/lib/database-runtime"
import type { DatabaseProvider, StorageBootstrapState } from "@/lib/database-provider"
import { Button } from "@/components/ui/button"

type Language = "en" | "ar"

const LANGUAGE_LOCALE: Record<Language, AppProps["locale"]> = {
    en: "en-US",
    ar: "ar-SA",
}

type LoadedModules = {
    App: React.ComponentType<AppProps>
}

performance.mark("boot:app-root:module:start")
console.info("[perf] app-root.tsx module start")
async function loadAppModules(): Promise<LoadedModules> {
    performance.mark("boot:app-root:app-import:start")

    const appModule = await import("./App")

    performance.mark("boot:app-root:app-import:end")
    performance.measure(
        "boot:app-root:app-import",
        "boot:app-root:app-import:start",
        "boot:app-root:app-import:end"
    )

    return {
        App: appModule.default,
    }
}

export function AppRoot() {
    const [storageLoading, setStorageLoading] = useState(true)
    const [storage, setStorage] = useState<StorageBootstrapState | null>(null)
    const [storageError, setStorageError] = useState<string | null>(null)
    const [clearingStorage, setClearingStorage] = useState(false)

    useEffect(() => {
        let active = true
        const load = async () => {
            try {
                const bootstrap = window.electronAPI?.storage
                    ? await window.electronAPI.storage.getBootstrap()
                    : { success: true, data: { config: null, configError: null, legacySqliteDatabaseFound: false, availableLocalDatabases: [], supabaseConnectionFound: false } satisfies StorageBootstrapState }
                if (!bootstrap.success || !bootstrap.data) throw new Error(bootstrap.error ?? "Could not read the storage configuration")
                if (active) setStorage(bootstrap.data)
                if (!bootstrap.data.config) return

                const provider = bootstrap.data.config.databaseProvider
                configureDatabaseProvider(provider)
                if (provider === "supabase") {
                    const storedConnection = await window.electronAPI!.storeConnection.get()
                    if (!storedConnection.success || !storedConnection.data?.connection) {
                        throw new Error(storedConnection.error ?? "The selected Supabase connection is missing or damaged")
                    }
                    configureSupabaseClient(storedConnection.data.connection)
                }
                const initialized = await window.electronAPI!.storage.initializeSelected()
                if (!initialized.success) throw new Error(initialized.error ?? "Could not initialize the selected database provider")
            } catch (error) {
                if (active) setStorageError(error instanceof Error ? error.message : "Could not initialize storage")
            } finally {
                if (active) setStorageLoading(false)
            }
        }
        void load()
        return () => { active = false }
    }, [])

    if (storageLoading) return <BootLoading />
    if (storageError) {
        const clearStoredProvider = async () => {
            if (clearingStorage) return
            setClearingStorage(true)
            setStorageError(null)
            try {
                const response = await window.electronAPI?.storage.returnToSetup()
                if (!response?.success) throw new Error(response?.error ?? "Could not clear the saved Supabase session")
                window.location.reload()
            } catch (error) {
                setStorageError(error instanceof Error ? error.message : "Could not clear the saved Supabase session")
                setClearingStorage(false)
            }
        }
        return (
            <div className="flex h-screen items-center justify-center p-6">
                <div className="max-w-lg space-y-4 text-center">
                    <p className="text-sm text-destructive">{storageError}</p>
                    <Button type="button" onClick={() => { void clearStoredProvider() }} disabled={clearingStorage}>
                        {clearingStorage ? "Signing out…" : "Sign out and return to setup"}
                    </Button>
                </div>
            </div>
        )
    }
    if (!storage?.config) return <FirstRunSetupScreen state={storage ?? { config: null, configError: null, legacySqliteDatabaseFound: false, availableLocalDatabases: [], supabaseConnectionFound: false }} />
    return <ConnectedAppRoot provider={storage.config.databaseProvider} />
}

function BootLoading() {
    return (
        <div className="flex h-screen items-center justify-center bg-background text-foreground">
            <div className="space-y-2 text-center">
                <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                <p className="text-sm font-medium">StoreOps Desktop</p>
            </div>
        </div>
    )
}

function ConnectedAppRoot({ provider }: { provider: DatabaseProvider }) {
    const [modules, setModules] = useState<LoadedModules | null>(null)
    const [signingOut, setSigningOut] = useState(false)
    const [signOutError, setSignOutError] = useState<string | null>(null)
    const auth = useDatabaseAuth()
    const { ready, error } = useAppBootstrap(!auth.loading && auth.session !== null)
    useSupabaseSync(provider === "supabase" && ready && auth.session !== null)
    const settings = useStore((state) => state.settings)
    const userPreferences = useStore((state) => state.userPreferences)
    const updateSettings = useStore((state) => state.updateSettings)
    const updateUserPreferences = useStore((state) => state.updateUserPreferences)
    const lang = (settings.appLanguage ?? "en") as Language
    const t = (key: string) => translations[lang][key] ?? translations.en[key] ?? key
    const returnToDatabaseSetup = async () => {
        const response = await window.electronAPI?.storage.returnToSetup()
        if (!response?.success) throw new Error(response?.error ?? t("auth.databaseSetupReturnFailed"))
        window.location.reload()
    }
    const signOutFromConnectionError = async () => {
        if (signingOut) return
        setSigningOut(true)
        setSignOutError(null)
        try {
            await signOutActiveDatabase({ localOnly: true })
            window.location.reload()
        } catch (caught) {
            setSigningOut(false)
            setSignOutError(caught instanceof Error ? caught.message : t("auth.signOutFailed"))
        }
    }

    useEffect(() => {
        let cancelled = false
        performance.mark("boot:app-root:load:start")
        loadAppModules().then((loaded) => {
            if (cancelled) return
            performance.mark("boot:app-root:load:end")
            performance.measure("boot:app-root:load", "boot:app-root:load:start", "boot:app-root:load:end")
            console.info("[perf] app-root.tsx modules loaded")
            setModules(loaded)
        }).catch((error) => {
            console.error("Failed to load app modules:", error)
        })

        return () => {
            cancelled = true
        }
    }, [])

    if (!modules || auth.loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <div className="space-y-2 text-center">
                    <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    <p className="text-sm font-medium">{t("app.loadingApplication")}</p>
                </div>
            </div>
        )
    }

    if (!auth.session) {
        return (
            <AuthScreen
                lang={lang}
                error={error ?? auth.error}
                onResolve={auth.resolveAccount}
                onSignIn={auth.signIn}
                onCompleteFirstLogin={auth.completeFirstLogin}
                onRequestPasswordRecovery={auth.requestPasswordRecovery}
                onCompletePasswordRecovery={auth.completePasswordRecovery}
                onReturnToDatabaseSetup={returnToDatabaseSetup}
            />
        )
    }

    if (error) {
        return (
            <div className="flex h-screen items-center justify-center p-6">
                <div className="space-y-4 text-center">
                    <p className="text-destructive font-medium">{t("app.databaseInitFailed")}</p>
                    <p className="text-muted-foreground text-sm">{error}</p>
                    <Button type="button" onClick={() => { void signOutFromConnectionError() }} disabled={signingOut}>
                        {signingOut ? t("auth.signingOut") : t("auth.signOutAndReturn")}
                    </Button>
                    {signOutError && <p className="text-destructive text-sm">{signOutError}</p>}
                </div>
            </div>
        )
    }

    if (!ready) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-foreground">
                <div className="space-y-2 text-center">
                    <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
                    <p className="text-sm font-medium">{t("app.loadingInventory")}</p>
                </div>
            </div>
        )
    }

    const { App } = modules
    const handleLangChange = (newLang: Language) => {
        updateSettings({ appLanguage: newLang })
    }

    return (
        <App
            ready={ready}
            lang={lang}
            theme={(settings.theme ?? "system") as "dark" | "light" | "system"}
            displayCurrency={userPreferences?.displayCurrency ?? "USD"}
            reportViewMode={userPreferences?.reportViewMode ?? "display"}
            locale={LANGUAGE_LOCALE[lang]}
            onThemeChange={(theme: AppProps["theme"]) => { void updateSettings({ theme }) }}
            onDisplayCurrencyChange={(code: string) => { void updateUserPreferences({ displayCurrency: code }) }}
            onReportViewModeChange={(mode: AppProps["reportViewMode"]) => { void updateUserPreferences({ reportViewMode: mode }) }}
            onLangChange={handleLangChange}
        />
    )
}
