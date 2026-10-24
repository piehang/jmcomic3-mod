/* eslint-disable no-restricted-globals */
const CACHE_NAME = "offline-cache-v2.1.12";
const OFFLINE_URL = "/offline.html?v=2.1.12";
const FALLBACK_IMAGE = "/images/cover_default.jpg?v=2.1.12";

const PRECACHE_URLS = [OFFLINE_URL, FALLBACK_IMAGE];

// =========================
// install
// =========================
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

// =========================
// activate
// =========================
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) return caches.delete(key);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// =========================
// helpers
// =========================

// 只快取自家 origin 的 app shell。API／廣告是跨網域又隨時在變，
// 存進來只會把 Cache Storage 撐爆，離線時還會拿到過期資料
function isAppShell(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

// precache 可能失敗（空間不足、安裝被打斷），這時不能讓 respondWith 收到 undefined，
// 那會直接變成 network error，導覽整頁掛掉
async function offlineDocument() {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) return cached;
  return new Response(
    '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<title>離線</title><body style=\"margin:0;height:100vh;display:flex;align-items:center;" +
      "justify-content:center;font-family:sans-serif;color:#757575\">" +
      "<p>目前無法連線，請檢查網路後重新開啟</p></body>",
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

// =========================
// fetch strategy
// =========================
self.addEventListener("fetch", (event) => {
  const { request } = event;

  //過濾非 http(s)
  if (request.method !== "GET" || !request.url.startsWith("http")) return;

  // -------------------------
  // HTML navigation
  // -------------------------
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlineDocument()));
    return;
  }

  // -------------------------
  // IMAGE: 不攔截
  // -------------------------
  // CDN 已給十年 max-age，瀏覽器自己的 HTTP 快取就夠；
  // 跨網域圖片是 opaque response，SW 這層存了也看不到 status
  if (request.destination === "image") return;

  // -------------------------
  // default: network first
  // -------------------------
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && isAppShell(request)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(async (err) => {
        const cached = await caches.match(request);
        if (cached) return cached;

        // 關鍵：子資源（script／style／fetch）絕對不能退 offline.html。
        // 瀏覽器會把那份 HTML 當成 JS 執行 → chunk 永遠註冊不了 → ChunkLoadError，
        // React.lazy 記住 rejection 之後整個路由就永久壞掉，使用者看到的是白屏且點不動。
        // 讓它照實失敗，前端的 lazyWithRetry 才有機會重試成功。
        throw err;
      })
  );
});
