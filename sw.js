/* 黄金看板 Service Worker：离线缓存应用外壳，行情数据走网络 */
const CACHE = 'gold-dash-v1'
const SHELL = [
  './',
  './index.html',
  './gold-local.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-512.jpg'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // 行情接口走网络，不缓存

  // 页面导航：网络优先，失败时用缓存的外壳
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
          return res
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match('./gold-local.html'))
        )
    )
    return
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
    })
  )
})
