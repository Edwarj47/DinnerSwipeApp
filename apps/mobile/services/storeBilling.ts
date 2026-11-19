import type { NativeBillingContext, StorePurchase, StoreProduct } from "./nativeBillingTypes";

export type StoreAdapter = {
  connect: (success: (purchase: StorePurchase) => void, failure: (message: string) => void) => Promise<() => void>;
  products: (context: NativeBillingContext) => Promise<StoreProduct | null>;
  buy: (context: NativeBillingContext, product: StoreProduct) => Promise<void>;
  restore: () => Promise<StorePurchase[]>;
  available: () => Promise<StorePurchase[]>;
  finish: (purchase: StorePurchase) => Promise<void>;
  manage: (context: NativeBillingContext) => Promise<void>;
};

export const storeProvider: "apple" | "google" | null = null;
export const storeAdapter: StoreAdapter = {
  connect: async () => () => undefined,
  products: async () => null,
  buy: async () => { throw new Error("Native purchases are unavailable on the web."); },
  restore: async () => [],
  available: async () => [],
  finish: async () => undefined,
  manage: async () => undefined
};
