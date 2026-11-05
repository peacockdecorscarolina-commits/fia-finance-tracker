import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { AccessGate } from "../components/AccessGate";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { initDatabase } from "../lib/db";
import { ThemeProvider } from "../lib/ThemeContext";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <SQLiteProvider databaseName="fia.db" onInit={initDatabase}>
          <AccessGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
            </Stack>
          </AccessGate>
        </SQLiteProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
