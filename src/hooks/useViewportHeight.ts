import { useEffect } from 'react'

/** CSS variable the app shell sizes itself from. Unset on desktop, where `dvh` is already correct. */
const HEIGHT_VAR = '--app-height'

/** Keeps the app shell sized to the space the software keyboard leaves behind.
 *
 *  `dvh` tracks the browser's own chrome (the URL bar collapsing as you scroll) but not the virtual
 *  keyboard — iOS opens the keyboard *over* the layout viewport rather than shrinking it. Without
 *  this the shell stays full height, so the status bar and whichever toolbar row sits at the bottom
 *  end up underneath the keyboard while you type.
 *
 *  `visualViewport` is the only thing that reports the actually-visible area, so mirror its height
 *  into a variable the stylesheet can use. Enabled only where a software keyboard exists: on a
 *  desktop this would also react to pinch-zoom, which is not something to resize the app for. */
export function useViewportHeight(enabled: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    if (!enabled || !vv) {
      root.style.removeProperty(HEIGHT_VAR)
      return
    }

    const apply = () => root.style.setProperty(HEIGHT_VAR, `${vv.height}px`)
    apply()
    // resize fires when the keyboard opens or closes; scroll fires when the keyboard pans the
    // viewport to keep the caret visible, which changes what's on screen without changing height.
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      root.style.removeProperty(HEIGHT_VAR)
    }
  }, [enabled])
}
