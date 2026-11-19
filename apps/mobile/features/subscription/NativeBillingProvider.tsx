import { useQueryClient } from "@tanstack/react-query";
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { addAuthChangeListener, apiFetch } from "@/services/api";
import { useAuthSession } from "@/services/session";
import { storeAdapter, storeProvider } from "@/services/storeBilling";
import { NativeBillingContext, NativeVerification, StoreProduct, StorePurchase } from "@/services/nativeBillingTypes";

type BillingState = { available: boolean; canRestore: boolean; busy: boolean; price?: string; message: string;
  buy: () => Promise<void>; restore: () => Promise<void>; manage: () => Promise<void>; retry: () => void };
const unavailable = async () => undefined;
const BillingContext = createContext<BillingState>({ available: false, canRestore: false, busy: false, message: "",
  buy: unavailable, restore: unavailable, manage: unavailable, retry: () => undefined });
export const useNativeBilling = () => useContext(BillingContext);

export function NativeBillingProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const session = useAuthSession();
  const queryClient = useQueryClient();
  const owner = session.authenticated ? session.userId : null;
  const epoch = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [context, setContext] = useState<NativeBillingContext | null>(null);
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const operations = useRef(new Set<string>());
  const verifyRef = useRef<(purchase: StorePurchase, context: NativeBillingContext) => Promise<boolean | undefined>>(async () => false);
  const recoverRef = useRef<() => Promise<void>>(async () => undefined);
  const retry = useCallback(() => { epoch.current++; setGeneration(n => n + 1); }, []);

  useEffect(() => addAuthChangeListener(() => {
    epoch.current++; setContext(null); setProduct(null); setConnected(false); setBusy(false); setMessage("");
    setGeneration(n => n + 1);
  }), []);

  useEffect(() => {
    const current = ++epoch.current;
    let stop: (() => void) | undefined;
    setContext(null); setProduct(null); setConnected(false); setBusy(false); setMessage("");
    operations.current = new Set();
    const valid = () => epoch.current === current;
    async function verify(purchase: StorePurchase, config: NativeBillingContext) {
      if (!valid() || !storeProvider || purchase.productId !== config[storeProvider].product_id) return;
      if (purchase.purchaseState === "pending") {
        setMessage("Payment is pending. Premium will activate after verification."); setBusy(false); return;
      }
      if (purchase.purchaseState !== "purchased") return;
      const binding = storeProvider === "apple" ? ("appAccountToken" in purchase ? purchase.appAccountToken : null)
        : ("obfuscatedAccountIdAndroid" in purchase ? purchase.obfuscatedAccountIdAndroid : null);
      if (binding && binding.toLowerCase() !== config[storeProvider].account_token.toLowerCase()) {
        setMessage("This purchase belongs to another Dinner Swipe account."); setBusy(false); return;
      }
      const reference = storeProvider === "apple" ? purchase.id : purchase.purchaseToken;
      if (!reference) throw new Error("The store did not return purchase evidence.");
      if (operations.current.has(reference)) return;
      operations.current.add(reference);
      try {
        const result = await apiFetch<NativeVerification>("/api/v1/subscription/native/verify", {
          method: "POST", body: JSON.stringify({ provider: storeProvider, reference })
        });
        if (!valid()) return;
        if (!result.verified) throw new Error("Purchase verification was not completed.");
        if (result.finish_transaction) await storeAdapter.finish(purchase);
        if (!valid()) return;
        await Promise.all([queryClient.invalidateQueries({ queryKey: ["subscription-status"] }),
          queryClient.invalidateQueries({ queryKey: ["premium-status"] }),
          queryClient.invalidateQueries({ queryKey: ["ai-recipe-usage"] })]);
        if (valid()) setMessage(result.subscription.premium_active ? "Premium is active." : "No active Premium subscription was found.");
        return valid() && result.subscription.premium_active;
      } finally { operations.current.delete(reference); if (valid()) setBusy(false); }
    }
    const process = (purchase: StorePurchase, config: NativeBillingContext) => verify(purchase, config).catch(error => {
      if (valid()) { setMessage(error instanceof Error ? error.message : "Unable to verify the purchase."); setBusy(false); }
    });
    verifyRef.current = verify;
    if (enabled && owner && storeProvider) void (async () => {
      try {
        const config = await apiFetch<NativeBillingContext>("/api/v1/subscription/native/context");
        if (!valid()) return;
        setContext(config);
        if (!config[storeProvider].enabled) { setMessage("Store subscriptions are not available yet."); return; }
        const disconnect = await storeAdapter.connect(p => { void process(p, config); }, text => {
          if (valid()) { setMessage(text); setBusy(false); }
        });
        if (!valid()) { disconnect(); return; }
        stop = disconnect;
        setConnected(true);
        const recover = async () => {
          for (const purchase of await storeAdapter.available()) {
            if (!valid()) return;
            await process(purchase, config);
          }
        };
        recoverRef.current = recover;
        await recover();
        const item = await storeAdapter.products(config);
        if (!valid()) return;
        setProduct(item);
        if (!item) setMessage("The monthly subscription is unavailable in this store.");
      } catch (error) { if (valid()) setMessage(error instanceof Error ? error.message : "Store connection unavailable."); }
    })();
    return () => { epoch.current++; recoverRef.current = async () => undefined; stop?.(); };
  }, [owner, enabled, generation, queryClient]);

  const invoke = async (action: "buy" | "restore" | "manage") => {
    if (!context || !storeProvider || !context[storeProvider].enabled || !connected || busy) return;
    if (action === "buy" && !product) return;
    const current = epoch.current;
    setBusy(true); setMessage("");
    try {
      if (action === "buy" && product) await storeAdapter.buy(context, product);
      else if (action === "manage") await storeAdapter.manage(context);
      else {
        // Restore need not emit callbacks; submit every returned purchase through the same verifier.
        const purchases = await storeAdapter.restore();
        if (current !== epoch.current) return;
        let restored = false;
        for (const purchase of purchases) {
          if (current !== epoch.current) return;
          if (purchase.productId !== context[storeProvider].product_id || purchase.purchaseState !== "purchased") continue;
          const active = await verifyRef.current(purchase, context);
          restored = Boolean(active) || restored;
        }
        if (current === epoch.current) {
          await queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
          await queryClient.invalidateQueries({ queryKey: ["premium-status"] });
          setMessage(restored ? "Premium restored." : "No active Premium subscription was found.");
        }
      }
    } catch (error) {
      if (current === epoch.current) setMessage(error instanceof Error ? error.message : "The store action failed.");
    } finally { if (current === epoch.current) setBusy(false); }
  };
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => {
      if (state === "active") {
        void queryClient.invalidateQueries({ queryKey: ["subscription-status"] });
        void recoverRef.current().catch(() => undefined);
      }
    });
    return () => listener.remove();
  }, [queryClient]);
  return <BillingContext.Provider value={{ available: connected && !!product && !!context, canRestore: connected, busy, price: product?.price, message,
    buy: () => invoke("buy"), restore: () => invoke("restore"), manage: () => invoke("manage"), retry }}>{children}</BillingContext.Provider>;
}
