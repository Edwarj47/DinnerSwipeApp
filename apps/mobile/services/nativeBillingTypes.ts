import type { Purchase } from "expo-iap";
import type { PremiumStatus } from "./types";

export type StorePurchase = Purchase;
export type StoreProduct = { id: string; price: string; offerToken?: string };
export type StoreContext = { enabled: boolean; product_id: string; account_token: string; base_plan_id?: string };
export type NativeBillingContext = { account_id: string; apple: StoreContext; google: StoreContext };
export type NativeVerification = { verified: boolean; finish_transaction: boolean; subscription: PremiumStatus };
