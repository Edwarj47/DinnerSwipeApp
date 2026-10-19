import { useEffect, useState } from "react";
import { lookupRetryDelay } from "@/services/apiErrors";

export function useLookupCooldown() {
  const [until, setUntil] = useState(0);
  useEffect(() => {
    if (!until) return;
    const timer = setTimeout(() => setUntil(0), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  return {
    waiting: until > Date.now(),
    recordFailure(reason: unknown) {
      const delay = lookupRetryDelay(reason);
      if (delay) setUntil(current => Math.max(current, Date.now() + delay));
    }
  };
}
