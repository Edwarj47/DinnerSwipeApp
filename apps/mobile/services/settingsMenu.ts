export type SettingsRequest = {
  tab?: "user" | "group";
  section?: "account" | "meals" | "macros";
  focus?: "subscription" | "planning";
  resetToken?: string;
  groupView?: "choices";
};
const listeners = new Set<(request: SettingsRequest) => void>();
export function openSettings(request: SettingsRequest = {}) {
  for (const listener of listeners) listener(request);
}
export function addSettingsListener(listener: (request: SettingsRequest) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
