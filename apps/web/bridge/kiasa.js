// KIASA ChatGPT Bridge, on KIASA's pages: says it is here, and carries a
// page's question to the extension (and ChatGPT's answer, and how it is
// going, back). Only KIASA's own pages, and only their own window's messages.
// A job's page to read is asked for by the job's number on KIASA's list: its
// link comes from KIASA itself, never from the page.
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const JOB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const reply = message => window.postMessage({ source: "kiasa-bridge", ...message }, window.location.origin);
  const asking = new Map();

  /** A question to the extension, its progress and answer passed back to the page. */
  function carry(id, question) {
    const port = chrome.runtime.connect({ name: "kiasa" });
    asking.set(id, port);
    port.onMessage.addListener(message => {
      reply({ id, ...message });
      if (message.type === "answer" || message.type === "error") { asking.delete(id); port.disconnect(); }
    });
    port.onDisconnect.addListener(() => {
      if (asking.delete(id)) reply({ id, type: "error", error: "The bridge stopped. Reload this page and try again." });
    });
    port.postMessage(question);
  }

  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "kiasa-page" || (data.id !== undefined && typeof data.id !== "string")) return;
    if (data.type === "hello") return reply({ type: "hello", version: VERSION });
    if (data.type === "ask" && typeof data.text === "string" && data.id) return carry(data.id, { type: "ask", text: data.text });
    if (data.type === "read" && typeof data.job === "string" && JOB.test(data.job) && data.id) {
      const found = await fetch(`/jobs/bridge/job?id=${data.job}`, { credentials: "same-origin", cache: "no-store" })
        .then(response => response.json()).catch(() => null);
      if (!found?.url) return reply({ id: data.id, type: "error", error: found?.error ?? "KIASA did not give the job's link." });
      return carry(data.id, { type: "read", url: found.url });
    }
    if (data.type === "status" && data.id) {
      return chrome.runtime.sendMessage({ type: "status" })
        .then(answer => reply({ id: data.id, type: "answer", answer }))
        .catch(() => reply({ id: data.id, type: "error", error: "The bridge did not answer. Reload this page." }));
    }
    if (data.type === "stop" && data.id) asking.get(data.id)?.postMessage({ type: "stop" });
  });
  reply({ type: "hello", version: VERSION });
})();
