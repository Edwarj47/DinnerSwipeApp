export const appConfig = {
  workingName: process.env.EXPO_PUBLIC_APP_NAME ?? "Dinner Swipe",
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8108",
  features: {
    aiIngestion: process.env.EXPO_PUBLIC_FEATURE_AI_INGESTION === "true"
  }
};

