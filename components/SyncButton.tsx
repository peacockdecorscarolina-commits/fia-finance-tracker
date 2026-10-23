import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { isSignedIn } from "../lib/googleAuth";
import { backupToDrive } from "../lib/googleDrive";
import { useTheme } from "../lib/ThemeContext";

const SUCCESS = "#16A34A";
const DANGER = "#DC2626";
// How long the checkmark / error mark stays before going back to the cloud.
const RESULT_MS = 2500;

type State = "idle" | "busy" | "done" | "error";

// One-tap "Back up now" for the header, so backing up doesn't need a trip to
// the Sync screen. Restore deliberately stays on that screen -- it overwrites
// this device's data. Web only, like the Sync screen itself (Google auth here
// is localStorage/redirect based).
export function SyncButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const db = useSQLiteContext();
  const [state, setState] = useState<State>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  if (Platform.OS !== "web") return null;

  function showResult(result: "done" | "error") {
    setState(result);
    resetTimer.current = setTimeout(() => setState("idle"), RESULT_MS);
  }

  async function handlePress() {
    if (state === "busy") return;
    // Signing in redirects away to Google, so send them to the screen that handles it.
    if (!isSignedIn()) {
      router.push("/sync");
      return;
    }
    setState("busy");
    try {
      await backupToDrive(db);
      showResult("done");
    } catch (err) {
      showResult("error");
      window.alert(err instanceof Error ? err.message : "Backup failed.");
    }
  }

  return (
    <Pressable onPress={handlePress} disabled={state === "busy"} style={style} accessibilityLabel="Back up to Google Drive">
      {state === "busy" ? (
        <ActivityIndicator size="small" color={colors.textPrimary} />
      ) : state === "done" ? (
        <Ionicons name="checkmark-circle" size={20} color={SUCCESS} />
      ) : state === "error" ? (
        <Ionicons name="alert-circle" size={20} color={DANGER} />
      ) : (
        <Ionicons name="cloud-upload-outline" size={20} color={colors.textPrimary} />
      )}
    </Pressable>
  );
}
