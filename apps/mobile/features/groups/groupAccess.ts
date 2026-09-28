import { QueryClient } from "@tanstack/react-query";

import { Household } from "@/services/types";

export function inviteCode(value: string) {
  const clean = value.trim();
  if (/^[a-z0-9]{8}$/i.test(clean)) return clean.toUpperCase();
  try {
    const url = new URL(clean);
    if (!(url.protocol === "https:" && url.hostname === "dinner.dcss.dev") && url.protocol !== "dinnerswipe:") return "";
    const code = url.searchParams.get("code") ?? "";
    return /^[a-z0-9]{8}$/i.test(code) ? code.toUpperCase() : "";
  } catch { return ""; }
}

export async function applyGroupChange(client: QueryClient, group: Household) {
  const keys = ["household", "households", "vote-options", "votes", "recipes", "profile"];
  await Promise.all(keys.map(key => client.cancelQueries({ queryKey: [key] })));
  client.setQueryData(["household"], group);
  await Promise.all(keys.map(key => client.invalidateQueries({ queryKey: [key] })));
}
