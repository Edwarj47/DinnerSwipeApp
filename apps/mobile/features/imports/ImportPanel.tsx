import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { API_URL, getToken } from "@/services/api";

type UploadResult = { batch_id: string; headers: string[]; suggested_mapping: Record<string, string | null>; rows: Record<string, string>[] };
type Preview = {
  summary: Record<string, number>;
  rows: {
    id: string;
    row_number: number;
    status: string;
    duplicate_status: string;
    warnings: string[];
    normalized_data: Record<string, unknown>;
  }[];
};

export function ImportPanel() {
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState("");

  async function sendFile(file: File) {
    const token = await getToken();
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API_URL}/api/v1/imports/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form
    });
    if (!response.ok) throw new Error(await response.text());
    setUpload((await response.json()) as UploadResult);
    setStatus("File scanned. Review mapping, then validate.");
  }

  async function validate() {
    if (!upload) return;
    const token = await getToken();
    const response = await fetch(`${API_URL}/api/v1/imports/${upload.batch_id}/mapping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ mapping: upload.suggested_mapping, accept_missing_photo: true })
    });
    if (!response.ok) throw new Error(await response.text());
    await response.json();
    const previewResponse = await fetch(`${API_URL}/api/v1/imports/${upload.batch_id}/preview`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    setPreview((await previewResponse.json()) as Preview);
    setStatus("Preview generated. Valid rows can now be imported.");
  }

  async function confirm() {
    if (!upload) return;
    const token = await getToken();
    const response = await fetch(`${API_URL}/api/v1/imports/${upload.batch_id}/confirm`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus("Valid rows imported. Invalid rows remain in review.");
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Batch import</Text>
      {Platform.OS === "web" ? (
        // React Native Web supports direct DOM input for this MVP upload control.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        React.createElement("input", {
          type: "file",
          accept: ".csv,.xlsx",
          "aria-label": "Upload CSV or XLSX recipe file",
          onChange: (event: { target: { files?: FileList } }) => {
            const file = event.target.files?.[0];
            if (file) void sendFile(file).catch((error) => setStatus(String(error)));
          }
        })
      ) : (
        <Text style={styles.meta}>Native file picker is prepared for a later Expo DocumentPicker integration.</Text>
      )}
      {upload ? (
        <View style={styles.preview}>
          <Text style={styles.meta}>Headers: {upload.headers.join(", ")}</Text>
          <Text style={styles.meta}>Suggested required fields: name, ingredients, instructions, photo.</Text>
          <View style={styles.actions}>
            <Button label="Validate" icon="checkmark-done" onPress={() => void validate().catch((error) => setStatus(String(error)))} />
            <Button label="Import valid" icon="cloud-upload" variant="primary" onPress={() => void confirm().catch((error) => setStatus(String(error)))} />
          </View>
        </View>
      ) : null}
      {preview ? <Text style={styles.meta}>Summary: {JSON.stringify(preview.summary)}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderRadius: 8, borderColor: Colors.border, borderWidth: 1, padding: 14, gap: 10, marginVertical: 12 },
  title: { fontSize: 19, fontWeight: "900", color: Colors.ink },
  meta: { color: Colors.muted, lineHeight: 20 },
  preview: { gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  status: { color: Colors.basil, fontWeight: "800" }
});
