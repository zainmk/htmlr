import { useSyncExternalStore } from 'react'

/** A value a component can subscribe to directly, rather than receiving it as a prop from the top.
 *
 *  For state that changes often but only matters to one small corner of the screen — the save status
 *  flips on the first keystroke after every save — so that changing it re-renders that corner
 *  instead of the whole app, editor and toolbar included. */
export interface Store<T> {
  get(): T
  /** Notifies subscribers only when the value actually changes. */
  set(value: T): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}
