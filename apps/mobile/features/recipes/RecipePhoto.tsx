import { Image, ImageProps } from "expo-image";
import { useState } from "react";

type Props = Omit<ImageProps, "source" | "placeholder" | "onError"> & { photoUrl?: string | null };

export function RecipePhoto({ photoUrl, contentFit = "cover", ...props }: Props) {
  const url = photoUrl?.trim() || null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPhoto = Boolean(url && failedUrl !== url);
  return <Image {...props} source={hasPhoto ? { uri: url! } : require("../../assets/icon.png")}
    placeholder={require("../../assets/icon.png")} placeholderContentFit="contain"
    contentFit={hasPhoto ? contentFit : "contain"}
    onError={() => { if (url) setFailedUrl(url); }} />;
}
