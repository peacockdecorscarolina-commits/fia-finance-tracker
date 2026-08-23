import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { initDatabase } from "../lib/db";
import { colors } from "../lib/theme";

const pushedScreenOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.cardSolid },
  headerTintColor: colors.textPrimary,
  headerTitleStyle: { fontWeight: "700" as const },
  headerBackTitle: "Back",
};

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="fia.db" onInit={initDatabase}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="review" options={{ title: "Review", ...pushedScreenOptions }} />
        <Stack.Screen name="accounts" options={{ title: "Accounts", ...pushedScreenOptions }} />
        <Stack.Screen name="categories" options={{ title: "Categories", ...pushedScreenOptions }} />
        <Stack.Screen name="category/[name]" options={{ title: "Category", ...pushedScreenOptions }} />
        <Stack.Screen name="account/[name]" options={{ title: "Account", ...pushedScreenOptions }} />
        <Stack.Screen name="sync" options={{ title: "Sync", ...pushedScreenOptions }} />
        <Stack.Screen
          name="move-transactions"
          options={{ title: "Move Transactions", ...pushedScreenOptions }}
        />
      </Stack>
    </SQLiteProvider>
  );
}
