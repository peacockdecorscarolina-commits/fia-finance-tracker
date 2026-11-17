import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { AccessGate } from "../components/AccessGate";
import { clearDatabaseReloads, ErrorBoundary } from "../components/ErrorBoundary";
import { ReleaseDatabaseOnLeave } from "../components/ReleaseDatabaseOnLeave";
import { initDatabase } from "../lib/db";
import { ThemeProvider } from "../lib/ThemeContext";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <SQLiteProvider
          databaseName="fia.db"
          onInit={async (db) => {
            await initDatabase(db);
            clearDatabaseReloads();
          }}
        >
          <ReleaseDatabaseOnLeave />
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
