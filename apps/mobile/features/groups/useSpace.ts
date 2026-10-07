import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/services/api";
import { Household } from "@/services/types";

export function useSpace() {
  const query = useQuery<Household>({ queryKey: ["household"], queryFn: () => apiFetch<Household>("/api/v1/households/current"), refetchInterval: 30_000 });
  const group = query.data;
  const groupId = group?.id && !group.is_personal ? group.id : undefined;
  return {
    ...query, group, groupId, key: groupId ?? "personal", canManage: !query.isLoading && !query.isError && (!groupId || group?.current_user_role === "owner"),
    path: (path: string) => groupId && /^\/api\/v1\/(weekly-plans|grocery-lists)(\/|$)/.test(path) ? path.replace("/api/v1/", `/api/v1/households/${groupId}/`) : path,
    queryKey: (name: string) => groupId ? [name, groupId] : [name]
  };
}
