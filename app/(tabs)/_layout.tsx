import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../lib/theme";

const TAB_BAR_CONTENT_HEIGHT = 56;

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          position: "absolute",
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: "transparent",
          borderTopWidth: 0,
        },
        // Explicitly sized to match tabBarStyle above -- letting BlurView's
        // absoluteFill infer its size from the parent risked it not
        // extending into the added safe-area padding on web, leaving a
        // plain unblurred gap below the tab labels on notched iPhones.
        tabBarBackground: () => (
          <BlurView
            intensity={80}
            tint="light"
            style={[StyleSheet.absoluteFill, { height: TAB_BAR_CONTENT_HEIGHT + insets.bottom }]}
          />
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
