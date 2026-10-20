import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTransientMessage } from "@/components/useTransientMessage";
import { deviceOffline, offlineOwner, useOfflineStatus } from "@/services/offlineStore";
import { dismissSources, getSources, sourcesKey } from "./api";
import { SourceOverview } from "./types";

export function useSourcesReview(owner: string, visible: boolean) {
  const client = useQueryClient();
  const offline = useOfflineStatus(state => state.offline);
  const mounted = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const lock = useRef(false);
  const [message, setMessage] = useTransientMessage();
  const enabled = visible && !offline;
  const currentOwner = () => mounted.current && offlineOwner() === owner;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!enabled) void client.cancelQueries({ queryKey: sourcesKey(owner), exact: true });
  }, [client, enabled, owner]);

  const query = useQuery<SourceOverview>({
    queryKey: sourcesKey(owner),
    queryFn: ({ signal }) => {
      if (!currentOwner() || !visibleRef.current || deviceOffline()) throw new Error("Source review unavailable.");
      return getSources(signal);
    },
    enabled, retry: false,
    refetchInterval: query => {
      if (!enabled || lock.current) return false;
      return query.state.data?.runs.some(run => run.status === "running") ? 5000 : 30000;
    }
  });
  const data: SourceOverview | undefined = query.data;
  const decision = useMutation({
    mutationFn: ({ runId, sourceId }: { runId: string; sourceId: string }) => {
      // onMutate awaits query cancellation; the account may change during that wait.
      if (!currentOwner() || !visibleRef.current || deviceOffline()) throw new Error("Source review unavailable.");
      return dismissSources(runId, [sourceId]);
    },
    retry: false, networkMode: "always",
    onMutate: async () => {
      setMessage("");
      await client.cancelQueries({ queryKey: sourcesKey(owner), exact: true });
    },
    onSuccess: async data => {
      if (!currentOwner()) return;
      await client.cancelQueries({ queryKey: sourcesKey(owner), exact: true });
      if (!currentOwner()) return;
      client.setQueryData(sourcesKey(owner), data);
      setMessage("Source dismissed.");
    },
    onError: async () => {
      if (currentOwner()) await client.invalidateQueries({ queryKey: sourcesKey(owner), exact: true });
    },
    onSettled: () => { lock.current = false; }
  });

  function dismiss(runId: string, sourceId: string) {
    if (!currentOwner() || !visibleRef.current || deviceOffline() || lock.current || query.isFetching || query.isError) return;
    const source = data?.runs.find(run => run.id === runId)?.sources.find(source => source.id === sourceId);
    if (source?.status !== "pending" || !/^[a-f0-9]{64}$/i.test(source.id)) return;
    lock.current = true;
    decision.mutate({ runId, sourceId });
  }
  return { data, query, decision, dismiss, message };
}
