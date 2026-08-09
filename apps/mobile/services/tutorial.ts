const listeners = new Set<() => void>();

export function openTutorial() {
  for (const listener of listeners) {
    listener();
  }
}

export function addTutorialListener(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
