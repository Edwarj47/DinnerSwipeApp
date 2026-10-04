import { useCallback, useEffect, useState } from "react";

export const SUCCESS_MESSAGE_MS = 5000;

export function useTransientMessage(persistent = false) {
  const [notice, setNotice] = useState({ message: "", revision: 0 });
  const setMessage = useCallback((message: string) => {
    setNotice(current => ({ message, revision: current.revision + 1 }));
  }, []);
  useEffect(() => {
    if (!notice.message || persistent) return;
    const timer = setTimeout(() => setNotice(current => current.revision === notice.revision
      ? { ...current, message: "" } : current), SUCCESS_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [notice, persistent]);
  return [notice.message, setMessage] as const;
}
