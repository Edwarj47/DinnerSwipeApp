import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { ThemeColors, useThemedStyles } from "@/components/theme";
import { useErasureReceipt } from "@/services/accountErasure";

export function AccountErasureReceipt() {
  const styles = useThemedStyles(createStyles);
  const receipt = useErasureReceipt(state => state.receipt);
  const close = () => useErasureReceipt.setState({ receipt: null });
  if (!receipt) return null;
  return <Modal transparent animationType="fade" visible onRequestClose={close}>
    <View style={styles.backdrop}><View style={styles.dialog} accessibilityViewIsModal>
      <Text accessibilityRole="header" style={styles.title}>{receipt.status === "complete" ? "Account deleted" : "Deletion in progress"}</Text>
      <Text style={styles.text}>{receipt.status === "complete"
        ? "Your account, private data and original shared contributions have been erased from the active service. Other members' independent records remain. Limited billing records and backups follow the privacy policy."
        : receipt.status === "cleanup_pending"
          ? "Your account data has been erased. Some private files are awaiting cleanup and are no longer accessible."
          : "Your account access has been revoked. Erasure is queued for retry; it has not yet completed."}</Text>
      <Text style={styles.text}>Account deletion does not cancel an existing subscription. Manage any renewal through the provider where you purchased it.</Text>
      {receipt.device_cleanup_pending ? <Text style={styles.text}>Some local data could not be cleared on this device. Clear the app's local storage to remove any remaining downloaded data.</Text> : null}
      <Text selectable style={styles.receipt}>Receipt: {receipt.receipt_id}</Text>
      <Button label="Done" icon="checkmark" variant="primary" onPress={close} />
    </View></View>
  </Modal>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.4)" },
  dialog: { width: "100%", maxWidth: 520, gap: 16, padding: 20, borderRadius: 8, backgroundColor: colors.surface },
  title: { color: colors.ink, fontWeight: "800", fontSize: 22 },
  text: { color: colors.muted, lineHeight: 22 },
  receipt: { color: colors.ink, fontSize: 12, lineHeight: 18 }
});
