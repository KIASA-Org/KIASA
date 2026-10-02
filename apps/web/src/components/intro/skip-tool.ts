import { useEffect } from "react";

type ModelContext = {
  registerTool: (
    tool: { name: string; description: string; inputSchema: object; execute: (input: unknown) => object },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

/** Offers Skip to browsers that expose WebMCP (`document.modelContext`). It is
 * feature-detected, calls the same handler as the Skip link, and can never
 * block the page: every failure is swallowed.
 */
export function useSkipTool() {
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: "skip_kiasa_intro",
        description: "Immediately dismiss the decorative KIASA intro and show the page or its pending loading state.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("Expected an empty object.");
          window.__kiasaIntro?.finish("skip");
          return { dismissed: true };
        },
      }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Optional interface. */ }
    return () => lifecycle.abort();
  }, []);
}
