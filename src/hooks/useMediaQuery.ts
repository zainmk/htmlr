import { useEffect, useState } from 'react'

/** Phone-shaped *and* touch-driven: the layout changes (drawer, toolbar in flow) apply only here.
 *  Deliberately not width alone — a desktop window dragged narrow should keep the desktop layout it
 *  has always had, not turn into a phone UI. */
export const MOBILE_QUERY = '(max-width: 768px) and (any-hover: none) and (pointer: coarse)'

/** Touch-only input: nothing attached to this device can hover, so every hover-driven affordance
 *  needs an explicit equivalent.
 *
 *  `any-hover: none` rather than `hover: none` is the important part. A touchscreen laptop or 2-in-1
 *  reports a coarse *primary* pointer and no primary hover while still having a trackpad — asking
 *  about the primary input alone classified those machines as phones, which showed them the touch
 *  affordances and hid the hover ones. `any-hover` asks whether hovering is possible at all. */
export const TOUCH_QUERY = '(any-hover: none) and (pointer: coarse)'

/** Whether *any* precise pointer exists — a mouse, trackpad or stylus — even when touch is the
 *  primary input. A touchscreen laptop matches both this and TOUCH_QUERY; a phone matches only
 *  TOUCH_QUERY. Use this for anything a precise pointer can do (dragging), rather than assuming a
 *  coarse primary pointer means there's nothing else attached. */
export const FINE_POINTER_QUERY = '(any-pointer: fine)'

/** Re-renders when a media query starts or stops matching, so layout decisions that can't be made
 *  in CSS alone (which component to render, whether a tap should close the drawer) stay in sync
 *  with the ones that can. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange() // the query may already have changed between first render and this effect
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
