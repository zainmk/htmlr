import { useEffect, useRef, useState } from 'react'

/** Whether the page is currently running as an installed, standalone app rather than a browser tab. */
function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return // already installed and running as one — nothing to offer

    const onBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault() // suppress the browser's own mini-infobar; we show our own button instead
      deferredPrompt.current = e
      setCanInstall(true)
    }
    const onInstalled = () => {
      deferredPrompt.current = null
      setCanInstall(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    const event = deferredPrompt.current
    if (!event) return
    await event.prompt()
    await event.userChoice
    // A given prompt event can only be used once, whether accepted or dismissed.
    deferredPrompt.current = null
    setCanInstall(false)
  }

  return { canInstall, install }
}
