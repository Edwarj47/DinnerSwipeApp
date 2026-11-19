import { Platform } from "react-native";
import type { NativeBillingContext } from "./nativeBillingTypes";
import type { StoreAdapter } from "./storeBilling";

export const storeProvider = Platform.OS === "ios" ? "apple" : Platform.OS === "android" ? "google" : null;
const sdk = () => import("expo-iap");
function contextFor(context: NativeBillingContext) {
  if (!storeProvider) throw new Error("This device does not support store purchases.");
  return context[storeProvider];
}

export const storeAdapter: StoreAdapter = {
  async connect(success, failure) {
    const iap = await sdk();
    const updates = iap.purchaseUpdatedListener(success);
    const errors = iap.purchaseErrorListener(error => {
      failure(error.code === iap.ErrorCode.UserCancelled ? "Purchase cancelled." : "The store could not complete the purchase.");
    });
    try {
      if (!await iap.initConnection()) throw new Error("Store connection unavailable.");
    } catch (error) {
      updates.remove(); errors.remove();
      throw error;
    }
    return () => { updates.remove(); errors.remove(); void iap.endConnection().catch(() => undefined); };
  },
  async products(context) {
    const config = contextFor(context);
    const products = await (await sdk()).fetchProducts({ skus: [config.product_id], type: "subs" });
    const product = products?.find(item => item.id === config.product_id && item.type === "subs");
    if (!product) return null;
    if (storeProvider === "apple") return { id: product.id, price: product.displayPrice };
    const offers = product.subscriptionOffers?.filter(offer => offer.basePlanIdAndroid === config.base_plan_id
      && !offer.installmentPlanDetailsAndroid && offer.pricingPhasesAndroid?.pricingPhaseList.length === 1
      && offer.pricingPhasesAndroid.pricingPhaseList[0].billingPeriod === "P1M"
      && offer.pricingPhasesAndroid.pricingPhaseList[0].recurrenceMode === 1);
    // Never silently select a trial, introductory offer, annual or installment plan.
    const offer = offers?.find(item => item.offerTokenAndroid);
    return offer?.offerTokenAndroid ? { id: product.id,
      price: offer.pricingPhasesAndroid!.pricingPhaseList[0].formattedPrice,
      offerToken: offer.offerTokenAndroid } : null;
  },
  async buy(context, product) {
    const config = contextFor(context);
    await (await sdk()).requestPurchase({ type: "subs", request: storeProvider === "apple"
      ? { apple: { sku: product.id, appAccountToken: config.account_token } }
      : { google: { skus: [product.id], obfuscatedAccountId: config.account_token,
        subscriptionOffers: [{ sku: product.id, offerToken: product.offerToken! }] } } });
  },
  async restore() {
    const iap = await sdk();
    await iap.restorePurchases();
    return iap.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
  },
  async finish(purchase) {
    // Google acknowledgement is server-owned, with a durable retry queue.
    if (storeProvider === "apple") await (await sdk()).finishTransaction({ purchase, isConsumable: false });
  },
  async available() { return (await sdk()).getAvailablePurchases({ onlyIncludeActiveItemsIOS: true }); },
  async manage(context) {
    await (await sdk()).deepLinkToSubscriptions({ skuAndroid: contextFor(context).product_id,
      packageNameAndroid: "dev.dcss.dinnerswipe" });
  }
};
