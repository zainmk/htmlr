import { useEffect, useMemo, useState } from 'react'
import { useMediaQuery, MOBILE_QUERY, TOUCH_QUERY, FINE_POINTER_QUERY } from './useMediaQuery'

/** What this device can actually do, named by capability rather than by device class.
 *
 *  Components ask `platform.canDragToReorder`, not `isTouch`. That keeps the *reason* an affordance
 *  is hidden next to the flag instead of buried in a conditional, lets tests force a platform
 *  instead of emulating a device, and means a case that doesn't fit the touch/mouse split (an iPad
 *  with a keyboard case, say) is fixed in one derivation rather than hunted across the components. */
export interface Platform {
  /** Sidebar as an overlay drawer over the note, or a column beside it. */
  layout: 'drawer' | 'columns'
  /** Whether hover exists at all. Anything hover-only needs an explicit equivalent when it doesn't. */
  pointer: 'touch' | 'mouse'
  /** Assigning a keyboard shortcut is pointless without a keyboard to press it with. */
  canAssignShortcuts: boolean
  /** Whether the HTML5 drag-and-drop API is usable. It never fires for touch, so anything built on
   *  it needs another route on a phone. (Reordering pinned notes deliberately doesn't use it — see
   *  Sidebar — so this now only covers dragging tools into the quick toolbar.) */
  canUseHtml5Drag: boolean
  /** Offer a file picker for pulling notes in — the only ingestion route where there's no folder. */
  canImportFiles: boolean
  /** Prefer the share sheet over a download. A download is close to useless on a phone; a share
   *  sheet is a worse answer than a download on a desktop. Callers still feature-check `canShare`. */
  prefersShareSheet: boolean
}

export function usePlatform(): Platform {
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const isTouch = useMediaQuery(TOUCH_QUERY)
  // Deliberately not `!isTouch`: a touchscreen laptop or 2-in-1 can report a coarse *primary*
  // pointer while still having a trackpad, and dragging works fine there. Asking whether any
  // precise pointer exists keeps the button fallback on real phones and nowhere else.
  const hasFinePointer = useMediaQuery(FINE_POINTER_QUERY)

  // A coarse pointer does not mean there's no keyboard — an iPad in a keyboard case is both, and
  // there is no media query for "has a keyboard". So assume none on touch, then upgrade the moment
  // a real modifier keypress arrives, which only a physical keyboard produces.
  const [sawPhysicalKeyboard, setSawPhysicalKeyboard] = useState(false)
  useEffect(() => {
    if (!isTouch || sawPhysicalKeyboard) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) setSawPhysicalKeyboard(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isTouch, sawPhysicalKeyboard])

  return useMemo<Platform>(() => ({
    layout: isMobile ? 'drawer' : 'columns',
    pointer: isTouch ? 'touch' : 'mouse',
    canAssignShortcuts: !isTouch || sawPhysicalKeyboard,
    canUseHtml5Drag: hasFinePointer,
    canImportFiles: isTouch,
    prefersShareSheet: isTouch,
  }), [isMobile, isTouch, hasFinePointer, sawPhysicalKeyboard])
}
