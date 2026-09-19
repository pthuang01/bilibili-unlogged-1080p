// ==UserScript==
// @name              Bilibili - 免登入觀看 1080P
// @name:zh-TW        Bilibili - 免登入觀看 1080P
// @name:zh-CN        哔哩哔哩 - 免登录观看 1080P
// @namespace         https://github.com/pthuang01/bilibili-unlogged-1080p
// @version           1.1.0
// @description       免登入狀態下解鎖 B 站 1080P 高清畫質
// @description:zh-TW 免登入狀態下解鎖 B 站 1080P 高清畫質
// @description:zh-CN 免登录状态下解锁 B 站 1080P 高清画质
// @author            DoReMi
// @match             *://www.bilibili.com/video/*
// @match             *://www.bilibili.com/bangumi/play/*
// @icon              https://www.bilibili.com/favicon.ico
// @run-at            document-start
// @grant             unsafeWindow
// @license           GPL-3.0
// ==/UserScript==

(function () {
  'use strict';

  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const doc = win.document || document;

  console.log('[Bili-1080P-Unlogged] 腳本啟動 (v2.1.0)，正在注入真 1080P 核心偽裝與防禦 Hook...');

  // 1. 注入 Cookie 與 LocalStorage 預設畫質
  try {
    const fakeUid = '10000000';
    if (!doc.cookie.includes('DedeUserID=')) {
      doc.cookie = `DedeUserID=${fakeUid}; path=/; domain=.bilibili.com`;
    }
  } catch (e) {}

  try {
    const profile = JSON.parse(localStorage.getItem('bpx_player_profile') || '{}');
    if (!profile.media) profile.media = {};
    profile.media.quality = 80;
    localStorage.setItem('bpx_player_profile', JSON.stringify(profile));
  } catch (e) {}

  // 2. 網路請求 URL 改寫
  function modifyPlayUrl(urlStr) {
    try {
      const parsed = new URL(urlStr, location.origin);
      if (parsed.pathname.includes('/x/player/wbi/playurl')) {
        parsed.pathname = parsed.pathname.replace('/x/player/wbi/playurl', '/x/player/playurl');
      }
      parsed.searchParams.set('qn', '80');
      parsed.searchParams.set('try_look', '1');
      parsed.searchParams.set('fourk', '1');
      parsed.searchParams.set('fnval', '4048');
      parsed.searchParams.set('fnver', '0');
      return parsed.toString();
    } catch (e) {
      return urlStr;
    }
  }

  // 3. 數據淨化器
  function sanitizeApiResponse(url, json) {
    if (!json || !json.data) return;
    const data = json.data;

    // A. 攔截 playurl: 確保 1080P 串流存在並設為當前畫質
    if (url.includes('/playurl')) {
      data.quality = 80;
      if (!data.accept_quality || !data.accept_quality.includes(80)) {
        data.accept_quality = [120, 112, 80, 64, 32, 16];
        data.accept_description = ['超清 4K', '高清 1080P+', '高清 1080P', '高清 720P', '清晰 480P', '流畅 360P'];
      }
      console.log('[Bili-1080P-Unlogged] 成功注入 1080P (QN 80) DASH 串流！');
    }

    // B. 核心突破：攔截 /x/player/v2 與 /x/player/wbi/v2 使用者資訊
    // 將 login_mid 與 mid 偽裝為合法已登入用戶 (10000000)，從根本上瓦解 player 的 Permission Denied 攔截！
    if (url.includes('/x/player/v2') || url.includes('/x/player/wbi/v2')) {
      data.login_mid = 10000000;
      data.mid = 10000000;
      if (data.level_info) {
        data.level_info.current_level = 6;
      }
      console.log('[Bili-1080P-Unlogged] 成功偽裝 /x/player/v2 使用者身分，已解除訪客畫質上限看門狗！');
    }
  }

  // Hook Fetch
  const origFetch = win.fetch;
  win.fetch = async function (...args) {
    let [resource, config] = args;
    let url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

    if (url && (url.includes('/x/player/wbi/playurl') || url.includes('/x/player/playurl'))) {
      const newUrl = modifyPlayUrl(url);
      url = newUrl;
      if (typeof resource === 'string') {
        args[0] = newUrl;
      } else if (resource && resource.url) {
        args[0] = new Request(newUrl, config);
      }
    }

    const response = await origFetch.apply(this, args);
    try {
      if (url && (url.includes('/playurl') || url.includes('/x/player/v2') || url.includes('/x/player/wbi/v2'))) {
        const clone = response.clone();
        const json = await clone.json();
        sanitizeApiResponse(url, json);
        return new Response(JSON.stringify(json), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    } catch (e) {}
    return response;
  };

  // Hook XMLHttpRequest
  const origOpen = win.XMLHttpRequest.prototype.open;
  const origSend = win.XMLHttpRequest.prototype.send;

  win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' && (url.includes('/x/player/wbi/playurl') || url.includes('/x/player/playurl'))) {
      url = modifyPlayUrl(url);
    }
    this._reqUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  win.XMLHttpRequest.prototype.send = function (...args) {
    if (this._reqUrl && (this._reqUrl.includes('/playurl') || this._reqUrl.includes('/x/player/v2') || this._reqUrl.includes('/x/player/wbi/v2'))) {
      const onReady = () => {
        if (this.readyState === 4 && this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            sanitizeApiResponse(this._reqUrl, data);
            const modifiedText = JSON.stringify(data);
            Object.defineProperty(this, 'responseText', { value: modifiedText, writable: true });
            Object.defineProperty(this, 'response', { value: modifiedText, writable: true });
          } catch (e) {}
        }
      };
      this.addEventListener('readystatechange', onReady, false);
    }
    return origSend.apply(this, args);
  };

  // 4. Hook 全局 __playinfo__
  let originalPlayinfo = win.__playinfo__;
  if (originalPlayinfo && originalPlayinfo.data) {
    sanitizeApiResponse('/playurl', originalPlayinfo);
  }

  Object.defineProperty(win, '__playinfo__', {
    configurable: true,
    enumerable: true,
    get() {
      return originalPlayinfo;
    },
    set(val) {
      if (val && val.data) {
        sanitizeApiResponse('/playurl', val);
      }
      originalPlayinfo = val;
    }
  });

  // 5. 播放器畫質控制器與自動切換
  let isUserManualQualitySwitch = false;

  const bindPlayerInstance = (player) => {
    if (!player || player._hooked1080p) return;
    player._hooked1080p = true;
    console.log('[Bili-1080P-Unlogged] 成功綁定官方播放器實例，正在接管畫質控制器！');

    if (typeof player.requestQuality === 'function') {
      const origRequestQuality = player.requestQuality;
      player.requestQuality = function (qn, ...args) {
        // 攔截定時器發起的自動降級
        if (qn < 80 && !isUserManualQualitySwitch) {
          console.log(`[Bili-1080P-Unlogged] 攔截試看結束降級 (QN: ${qn})，強制保持 1080P！`);
          return Promise.resolve();
        }
        return origRequestQuality.call(this, qn, ...args);
      };
    }

    // 自動切換到 1080P
    setTimeout(() => {
      try {
        const qInfo = player.getQuality ? player.getQuality() : null;
        const nowQ = qInfo && typeof qInfo === 'object' ? qInfo.nowQ : qInfo;
        if (nowQ !== 80 && typeof player.requestQuality === 'function') {
          console.log('[Bili-1080P-Unlogged] 自動調用 requestQuality(80) 升級至 1080P...');
          isUserManualQualitySwitch = true;
          player.requestQuality(80).then(() => {
            console.log('[Bili-1080P-Unlogged] 1080P 畫質切換成功！');
          }).catch(e => {
            console.warn('[Bili-1080P-Unlogged] 切換失敗:', e);
          }).finally(() => {
            setTimeout(() => { isUserManualQualitySwitch = false; }, 1000);
          });
        }
      } catch (e) {}
    }, 1200);
  };

  let _playerInstance = win.player;
  Object.defineProperty(win, 'player', {
    configurable: true,
    enumerable: true,
    get() {
      return _playerInstance;
    },
    set(p) {
      _playerInstance = p;
      bindPlayerInstance(p);
    }
  });

  setInterval(() => {
    if (win.player) {
      bindPlayerInstance(win.player);
    }
  }, 1000);

  // 6. 模組 D：防禦 miniLogin 登入彈窗
  let _miniLogin = win.miniLogin;
  Object.defineProperty(win, 'miniLogin', {
    configurable: true,
    enumerable: true,
    get() {
      return _miniLogin;
    },
    set(val) {
      if (val && typeof val === 'object') {
        if (typeof val.show === 'function') {
          val.show = function () {
            console.log('[Bili-1080P-Unlogged] 成功阻斷 miniLogin.show() 彈窗呼叫！');
            return Promise.resolve();
          };
        }
        if (typeof val.regist === 'function') {
          val.regist = function () {
            return Promise.resolve();
          };
        }
      }
      _miniLogin = val;
    }
  });

  // 7. 使用者主動操作感知與定時暫停攔截
  let lastUserActionTime = 0;
  let lastActionType = '';

  const markUserAction = (type) => {
    lastUserActionTime = Date.now();
    lastActionType = type;
  };

  window.addEventListener('click', () => markUserAction('click'), true);
  window.addEventListener('pointerdown', () => markUserAction('pointerdown'), true);
  window.addEventListener('dblclick', () => markUserAction('dblclick'), true);
  window.addEventListener('keydown', (e) => {
    if (['Space', 'KeyK', 'KeyF', 'KeyW', 'KeyT', 'Escape', 'MediaPlayPause'].includes(e.code) || e.key === 'Escape') {
      markUserAction(`key_${e.code || e.key}`);
    }
  }, true);

  const origPause = win.HTMLVideoElement.prototype.pause;
  win.HTMLVideoElement.prototype.pause = function (...args) {
    const timeSinceAction = Date.now() - lastUserActionTime;
    const isUserTriggered = timeSinceAction < 500;
    const isAtEnd = this.duration && (this.currentTime >= this.duration - 1);

    if (isUserTriggered || isAtEnd) {
      return origPause.apply(this, args);
    }

    console.log(`[Bili-1080P-Unlogged] 成功攔截定時器觸發的非主動 pause() (進度: ${this.currentTime.toFixed(1)}s)！`);
    cleanLoginDialogs();
    return;
  };

  // 8. 全螢幕退出保護
  const hookExitFullscreen = (targetDoc) => {
    const methods = ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'];
    methods.forEach(method => {
      if (typeof targetDoc[method] === 'function') {
        const origMethod = targetDoc[method];
        targetDoc[method] = function (...args) {
          const timeSinceAction = Date.now() - lastUserActionTime;
          const isUserTriggered = timeSinceAction < 500;

          if (isUserTriggered) {
            console.log(`[Bili-1080P-Unlogged] 使用者主動退出全螢幕 (${lastActionType})，放行。`);
            return origMethod.apply(this, args);
          }

          console.log('[Bili-1080P-Unlogged] 成功阻斷定時器觸發的非主動 exitFullscreen() 縮回全螢幕呼叫！');
          return Promise.resolve();
        };
      }
    });
  };

  hookExitFullscreen(doc);
  if (win.document && win.document !== doc) {
    hookExitFullscreen(win.document);
  }

  // 9. DOM 即時銷毀彈窗
  function cleanLoginDialogs() {
    const selectors = [
      '.bili-mini-mask',
      '.bili-mini-login-right-wp',
      '.bili-mini-content-wp',
      '.bpx-player-dialog-wrap[data-type="trial"]',
      '.bili-player-trial-wrap',
      '.bpx-player-trylook-wrap',
      '.bpx-player-dialog-trylook',
      '.login-panel-pop',
      '.passport-login-container'
    ];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.remove();
      });
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (
              node.classList?.contains('bili-mini-mask') ||
              node.classList?.contains('bili-mini-login-right-wp') ||
              node.querySelector?.('.bili-mini-mask, .bili-mini-close-icon, .login-scan-wp')
            ) {
              node.remove();
              console.log('[Bili-1080P-Unlogged] MutationObserver 即時銷毀了 miniLogin 遮罩！');
              const video = document.querySelector('video');
              if (video && video.paused) {
                video.play().catch(() => {});
              }
            }
          }
        }
      }
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // 10. 全局樣式強制隱藏彈窗
  const style = document.createElement('style');
  style.textContent = `
    .bili-mini-mask,
    .bili-mini-login-right-wp,
    .bili-mini-content-wp,
    .bpx-player-dialog-wrap[data-type="trial"],
    .bili-player-trial-wrap,
    .bpx-player-trylook-wrap,
    .bpx-player-dialog-trylook,
    .bpx-player-trylook-tip,
    .login-panel-pop,
    .passport-login-container {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
      opacity: 0 !important;
      z-index: -99999 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  console.log('[Bili-1080P-Unlogged] v2.1.0 所有模組注入完成。');
})();
