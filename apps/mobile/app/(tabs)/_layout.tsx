import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { Colors } from "@/components/theme";

const icons = {
  index: "flame-outline",
  week: "calendar-outline",
  grocery: "basket-outline",
  recipes: "book-outline",
  profile: "person-outline"
} as const;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: Colors.tomato,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: { height: 64, paddingBottom: 10, paddingTop: 6 },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={icons[route.name as keyof typeof icons]} size={size} color={color} />
        )
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Discover" }} />
      <Tabs.Screen name="week" options={{ title: "This Week" }} />
      <Tabs.Screen name="grocery" options={{ title: "Grocery" }} />
      <Tabs.Screen name="recipes" options={{ title: "Recipes" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

