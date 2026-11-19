import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { clearWorkoutOwner } from "@/features/workouts/storage";
import { eraseOfflineAccount } from "./offlineStore";

export type ErasureReceipt = { status: "complete" | "cleanup_pending" | "pending"; receipt_id: string; device_cleanup_pending?: boolean };
export const useErasureReceipt = create<{ receipt: ErasureReceipt | null }>(() => ({ receipt: null }));

export async function eraseLocalAccountData(owner: string) {
  const results = await Promise.allSettled([eraseOfflineAccount(owner), clearWorkoutOwner(owner), AsyncStorage.multiRemove([
    "dinnerSwipe.appearance.v1." + owner,
    "dinnerSwipe.tutorial.tasks.v1." + owner,
    "dinnerSwipe.workouts.preferences.v1." + owner
  ])]);
  if (results.some(result => result.status === "rejected")) throw new Error("Some device data could not be cleared.");
}
