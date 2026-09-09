import { useEffect, useRef, useState } from 'react'

/** How an iOS visitor can install the app, since Safari never fires `beforeinstallprompt`. */
export type IosInstallHint = 'add-to-home' | 'open-in-safari' | null

/** Whether the page is currently running as an installed, standalone app rather than a browser tab. */
function isStandalone(): boolean {
  // `navigator.standalone` is the iOS-only signal — matchMedia('display-mode: standalone') is not
  // reliable there for Home Screen launches.
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

function isIosDevice(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; a touch-capable "Macintosh" is really an iPad.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Every iOS browser is WebKit underneath, but only Safari's share sheet offers Add to Home Screen. */
function isIosSafari(): boolean {
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(false)
  // iOS has no install prompt to capture, so the app has to tell the user the gesture instead —
  // which matters more there than anywhere else: the Home Screen app is where iOS grants the more
  // durable storage bucket that keeps notes from being evicted.
  const [iosInstallHint, setIosInstallHint] = useState<IosInstallHint>(null)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return // already installed and running as one — nothing to offer
    if (isIosDevice()) setIosInstallHint(isIosSafari() ? 'add-to-home' : 'open-in-safari')

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

  return { canInstall, install, iosInstallHint }
}
