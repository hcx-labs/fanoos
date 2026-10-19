// Native CDP client. Run against a dedicated headless Chrome profile, never your daily browser.
const endpoint = process.env.CHROME_DEBUG_URL || "http://127.0.0.1:9333";
const tabs = await (await fetch(`${endpoint}/json/list`)).json();
const tab = tabs.find((entry) => entry.type === "page");
if (!tab) throw new Error("Open a blank page in the headless Chrome instance first.");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
const handlers = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return handlers.get(message.method)?.(message.params);
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (!request) return;
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
export function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
export const on = (method, handler) => handlers.set(method, handler);
export async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
export const close = () => ws.close();
