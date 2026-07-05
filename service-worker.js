// 缓存名称和版本
const CACHE_NAME = 'homework-record-v1';

// 需要缓存的资源列表
const urlsToCache = [
  '/',
  '/index.html',
  '/js/app.js',
  '/js/mockData.js',
  '/static/images/favicon/apple-touch-icon.png',
  '/static/images/favicon/favicon-32x32.png',
  '/static/images/favicon/favicon-16x16.png',
  '/static/images/favicon/site.webmanifest',
  '/static/images/favicon/android-chrome-192x192.png',
  '/static/images/favicon/android-chrome-512x512.png',
  '/static/images/favicon/favicon.ico',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/css/font-awesome.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js'
];

// 安装Service Worker并缓存资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('打开缓存');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // 强制等待中的Service Worker变为激活状态
  );
});

// 激活Service Worker并清理旧缓存
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => self.clients.claim()) // 立即控制所有客户端
  );
});

// 处理资源请求
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 如果在缓存中找到资源，则返回缓存的资源
        if (response) {
          return response;
        }

        // 否则，尝试从网络获取资源
        return fetch(event.request)
          .then((response) => {
            // 检查响应是否有效
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // 复制响应
            const responseToCache = response.clone();

            // 将新资源添加到缓存
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // 如果是HTML请求且网络请求失败，返回缓存的首页
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// 处理推送通知
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/static/images/favicon/apple-touch-icon.png',
      badge: '/static/images/favicon/favicon-32x32.png',
      data: {
        url: data.url || '/'
      }
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// 处理通知点击
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});