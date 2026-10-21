/* 四级单词复习（静态版）- Service Worker：网络优先，离线回退缓存 */
const CACHE = 'cet4-static-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return
  // 只缓存本站资源；GitHub API 和 raw 词库不缓存，保证数据新鲜
  if (url.origin !== self.location.origin) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(e.request)
        if (fresh.ok) cache.put(e.request, fresh.clone())
        return fresh
      } catch (err) {
        const hit = await cache.match(e.request)
        if (hit) return hit
        throw err
      }
    }),
  )
})
