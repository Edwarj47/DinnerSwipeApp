import { Image, ImageProps } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { API_URL, apiFetch } from "../../services/api";

type Props = Omit<ImageProps, "source" | "placeholder" | "onError"> & { photoUrl?: string | null; fallbackStyle?: ImageProps["style"] };

export function RecipePhoto({ photoUrl, contentFit = "cover", fallbackStyle, ...props }: Props) {
  const candidate = photoUrl?.trim() || null;
  let url: string | null = null;
  let cacheKey: string | undefined;
  try {
    if (candidate) {
      const parsed = new URL(candidate);
      if (parsed.origin === new URL(API_URL).origin && parsed.pathname.startsWith("/api/v1/media/")) {
        url = candidate;
        cacheKey = `${parsed.origin}${parsed.pathname}?v=${parsed.searchParams.get("v") ?? ""}`;
      }
    }
  } catch { /* Untrusted or incomplete image URLs use the local placeholder. */ }
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [renewed, setRenewed] = useState<{ original: string; value: string } | null>(null);
  const attempted = useRef(new Set<string>());
  const current = useRef(url);
  current.current = url;
  useEffect(() => () => { current.current = null; }, []);
  const displayedUrl = renewed?.original === url ? renewed.value : url;
  const hasPhoto = Boolean(displayedUrl && failedUrl !== displayedUrl);
  const renew = async () => {
    if (!url || attempted.current.has(url)) return;
    attempted.current.add(url);
    const original = url;
    try {
      const path = new URL(original).pathname;
      const result = await apiFetch<{ photo_url: string | null }>(`${path}/link`);
      if (current.current === original && result.photo_url) {
        setRenewed({ original, value: result.photo_url });
        setFailedUrl(null);
      }
    } catch { /* Offline or unavailable photos retain the local placeholder. */ }
  };
  return <Image {...props} style={[props.style, !hasPhoto && fallbackStyle]} source={hasPhoto ? { uri: displayedUrl!, cacheKey } : require("../../assets/icon.png")}
    placeholder={require("../../assets/icon.png")} placeholderContentFit="contain"
    contentFit={hasPhoto ? contentFit : "contain"}
    onError={() => { if (displayedUrl) setFailedUrl(displayedUrl); void renew(); }} />;
}
