import * as ImagePicker from "expo-image-picker";
import React, { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";

export type RecipeImage = { uri: string; name: string; type: string; file?: File };

export function appendRecipeImage(form: FormData, name: string, image: RecipeImage) {
  form.append(name, image.file ?? ({ uri: image.uri, name: image.name, type: image.type } as unknown as Blob));
}

export function RecipePhotoPicker({ onSelect, disabled = false }: { onSelect: (image: RecipeImage) => Promise<void> | void; disabled?: boolean }) {
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function select(image: RecipeImage, size?: number) {
    if (size && size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
    await onSelect(image);
  }
  async function run(action: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to open photo."); }
    finally { setBusy(false); }
  }
  async function nativePhoto(take: boolean) {
    const permission = take ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(take ? "Allow camera access in device settings to take a photo." : "Allow photo access in device settings to choose a photo.");
    const options = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 };
    const result = take ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await select({ uri: asset.uri, name: asset.fileName ?? "recipe-photo.jpg", type: asset.mimeType ?? "image/jpeg" }, asset.fileSize);
  }
  const controls = <View style={{ gap: 8 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button label="Choose photo" icon="image" disabled={busy || disabled} onPress={() => Platform.OS === "web" ? library.current?.click() : void run(() => nativePhoto(false))} />
      <Button label="Take photo" icon="camera" disabled={busy || disabled} onPress={() => Platform.OS === "web" ? camera.current?.click() : void run(() => nativePhoto(true))} />
    </View>
    {busy ? <Text style={{ color: Colors.muted }}>Preparing photo...</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: Colors.danger }}>{error}</Text> : null}
  </View>;
  if (Platform.OS !== "web") return controls;
  function selectFile(file?: File) {
    if (file) void run(() => select({ uri: "", name: file.name, type: file.type, file }, file.size));
  }
  return React.createElement("div", {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop: (event: React.DragEvent) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }
  }, controls, ...([false, true].map(take => React.createElement("input", {
    key: String(take), ref: take ? camera : library, type: "file", accept: "image/jpeg,image/png,image/webp",
    capture: take ? "environment" : undefined, style: { display: "none" },
    "aria-label": take ? "Take recipe photo" : "Upload recipe photo",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => { selectFile(event.target.files?.[0]); event.target.value = ""; }
  }))));
}
