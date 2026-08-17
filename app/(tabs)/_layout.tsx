import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { colors } from "../../lib/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { position: "absolute", backgroundColor: "transparent", borderTopWidth: 0 },
        tabBarBackground: () => (
          <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Transactions",
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="upload"
        options={{
          title: "Upload",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cloud-upload-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="summary"
        options={{
          title: "Summary",
          tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
