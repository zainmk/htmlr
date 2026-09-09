export {}

declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[]
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
    prompt(): Promise<void>
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }

  /** Non-standard, iOS only: true when the page was launched from a Home Screen icon. */
  interface Navigator {
    standalone?: boolean
  }
}
