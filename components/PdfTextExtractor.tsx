import * as FileSystem from "expo-file-system";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

// Pinned version so a future pdf.js release can't silently break this.
const PDFJS_VERSION = "6.2.108";
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

// Runs entirely inside the WebView's JS context, which (unlike React
// Native's own JS engine) has real browser APIs (atob, Web Workers, ES
// modules) that pdf.js needs. This is the whole reason a WebView is used
// here instead of calling a parsing library directly from React Native.
function buildHtml(base64Pdf: string): string {
  return `<!DOCTYPE html>
<html>
<body>
<script>window.PDF_BASE64 = "${base64Pdf}";</script>
<script type="module">
  import * as pdfjsLib from "${PDFJS_URL}";
  pdfjsLib.GlobalWorkerOptions.workerSrc = "${PDFJS_WORKER_URL}";

  function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  (async () => {
    try {
      const data = base64ToUint8Array(window.PDF_BASE64);
      const doc = await pdfjsLib.getDocument({ data }).promise;
      let text = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item) => item.str).join(" ") + "\\n";
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, text }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, error: String(err) }));
    }
  })();
</script>
</body>
</html>`;
}

export type PdfTextExtractorHandle = {
  extractText: (uri: string) => Promise<string>;
};

type Pending = { resolve: (text: string) => void; reject: (err: Error) => void };

export const PdfTextExtractor = forwardRef<PdfTextExtractorHandle, object>((_props, ref) => {
  const [html, setHtml] = useState<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  useImperativeHandle(ref, () => ({
    extractText: async (uri: string) => {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return new Promise<string>((resolve, reject) => {
        pendingRef.current = { resolve, reject };
        setHtml(buildHtml(base64));
      });
    },
  }));

  function handleMessage(event: WebViewMessageEvent) {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    try {
      const result = JSON.parse(event.nativeEvent.data);
      if (result.ok) pending.resolve(result.text);
      else pending.reject(new Error(result.error));
    } catch (err) {
      pending.reject(err as Error);
    }
  }

  return (
    <View style={{ position: "absolute", top: -2000, left: 0, width: 300, height: 300 }} pointerEvents="none">
      {html && (
        <WebView originWhitelist={["*"]} source={{ html }} javaScriptEnabled onMessage={handleMessage} />
      )}
    </View>
  );
});
