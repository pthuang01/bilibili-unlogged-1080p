// ==UserScript==
// @name              Bilibili - 免登入觀看 1080P
// @name:zh-TW        Bilibili - 免登入觀看 1080P
// @namespace         https://github.com/pthuang01/bilibili-unlogged-1080p
// @version           2.0.0
// @description       免登入狀態下解鎖 B 站 1080P 高清畫質
// @description:zh-TW 免登入狀態下解鎖 B 站 1080P 高清畫質
// @author            DoReMi
// @match             https://www.bilibili.com/video/*
// @icon              https://www.bilibili.com/favicon.ico
// @run-at            document-start
// @grant             unsafeWindow
// @license           GPL-3.0
// ==/UserScript==

/**
 * ============================================================================
 * Bilibili 1080P Unlogged Playback Engine (Clean Architecture Edition)
 * ----------------------------------------------------------------------------
 * 架構設計原則：
 * 1. Single Responsibility Principle (SRP): 每個模組僅負責單一領域（網路/意圖/UI/播放器）。
 * 2. High Cohesion, Low Coupling: 模組間透過明確介面與配置通訊，不依賴全局閉包狀態。
 * 3. Zero Build Overhead: 採用標準 ES6+ Class，維持單檔結構，相容本地開發聯結器。
 * ============================================================================
 */

(function () {
  'use strict';

  // 0. 環境感知：取得頂層 Window 與 Document 物件
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const doc = win.document || document;

  // =========================================================================
  // 1. 常數與全域配置註冊表 (Configuration & Constants Registry)
  // =========================================================================
  const CONFIG = Object.freeze({
    APP: {
      NAME: 'Bili-1080P',
      VERSION: '2.0.0',
      TAG: '[Bili-1080P v2.0]'
    },
    QUALITY: {
      FHD_1080P: 80,
      SD_480P: 32,
      LD_360P: 16,
      ACCEPT_QUALITIES: [120, 112, 80, 64, 32, 16],
      ACCEPT_DESCRIPTIONS: ['超清 4K', '高清 1080P+', '高清 1080P', '高清 720P', '清晰 480P', '流畅 360P']
    },
    AUTH: {
      FAKE_MID: '10000000',
      FAKE_LEVEL: 6,
      COOKIE_KEY: 'DedeUserID'
    },
    TIMING: {
      USER_ACTION_EXPIRY_MS: 500,
      AUTO_PROMOTE_DELAY_MS: 1200,
      WATCHDOG_INTERVAL_MS: 1000
    },
    ROUTES: {
      WBI_PLAYURL: '/x/player/wbi/playurl',
      CLEAN_PLAYURL: '/x/player/playurl',
      USER_INFO_V2: '/x/player/v2',
      USER_INFO_WBI_V2: '/x/player/wbi/v2'
    },
    SELECTORS: {
      LOGIN_MODALS: [
        '.bili-mini-mask',
        '.bili-mini-login-right-wp',
        '.bili-mini-content-wp',
        '.bpx-player-dialog-wrap[data-type="trial"]',
        '.bili-player-trial-wrap',
        '.bpx-player-trylook-wrap',
        '.bpx-player-dialog-trylook',
        '.bpx-player-trylook-tip',
        '.login-panel-pop',
        '.passport-login-container'
      ]
    },
    HOTKEYS: ['Space', 'KeyK', 'KeyF', 'KeyW', 'KeyT', 'Escape', 'MediaPlayPause']
  });

  // =========================================================================
  // 2. 結構化日誌服務 (Logger Service)
  // =========================================================================
  class Logger {
    static info(...args) {
      console.log(CONFIG.APP.TAG, ...args);
    }
    static warn(...args) {
      console.warn(CONFIG.APP.TAG, ...args);
    }
    static error(...args) {
      console.error(CONFIG.APP.TAG, ...args);
    }
    static debug(...args) {
      if (win.__BILI_DEBUG__) {
        console.debug(CONFIG.APP.TAG, '[DEBUG]', ...args);
      }
    }
  }

  // =========================================================================
  // 3. 安全切面管理員 (HookManager - Safe AOP Engine)
  // =========================================================================
  class HookManager {
    /**
     * 安全劫持物件上的特定函數
     * @param {Object} target - 目標物件
     * @param {string} methodName - 函數名稱
     * @param {Function} factory - 回呼函數，參數傳入原函數，回傳新包裝函數
     */
    static hookMethod(target, methodName, factory) {
      if (!target || typeof target[methodName] !== 'function') {
        Logger.debug(`Target or method [${methodName}] does not exist on target.`);
        return;
      }
      const original = target[methodName];
      const wrapped = factory(original);
      target[methodName] = wrapped;
      Logger.debug(`Successfully hooked method [${methodName}].`);
    }

    /**
     * 安全劫持物件屬性 (Object.defineProperty)
     * @param {Object} target - 目標物件
     * @param {string} propName - 屬性名稱
     * @param {Object} descriptor - Getter / Setter 描述符
     */
    static hookProperty(target, propName, descriptor) {
      try {
        Object.defineProperty(target, propName, {
          configurable: true,
          enumerable: true,
          ...descriptor
        });
        Logger.debug(`Successfully hooked property [${propName}].`);
      } catch (err) {
        Logger.error(`Failed to hook property [${propName}]:`, err);
      }
    }
  }

  // =========================================================================
  // 4. 使用者真實意圖感知服務 (UserIntentTracker)
  // =========================================================================
  class UserIntentTracker {
    static lastActionTime = 0;
    static lastActionType = '';

    static init() {
      const markAction = (type) => {
        UserIntentTracker.lastActionTime = Date.now();
        UserIntentTracker.lastActionType = type;
        Logger.debug(`User action recorded: ${type}`);
      };

      // 監聽滑鼠、指標與雙擊
      win.addEventListener('click', () => markAction('click'), true);
      win.addEventListener('pointerdown', () => markAction('pointerdown'), true);
      win.addEventListener('dblclick', () => markAction('dblclick'), true);

      // 監聽鍵盤全螢幕與暫停快捷鍵
      win.addEventListener('keydown', (e) => {
        if (CONFIG.HOTKEYS.includes(e.code) || e.key === 'Escape') {
          markAction(`key_${e.code || e.key}`);
        }
      }, true);

      Logger.info('UserIntentTracker initialized.');
    }

    /**
     * 判定當前呼叫是否為使用者在有效時間內主動發起
     * @param {number} thresholdMs - 有效容許時間差（預設 500ms）
     * @returns {boolean}
     */
    static isRecentUserAction(thresholdMs = CONFIG.TIMING.USER_ACTION_EXPIRY_MS) {
      return (Date.now() - UserIntentTracker.lastActionTime) < thresholdMs;
    }

    static getLastActionType() {
      return UserIntentTracker.lastActionType;
    }
  }

  // =========================================================================
  // 5. 網路請求管道中介軟體 (NetworkInterceptor & Middleware Pipeline)
  // =========================================================================
  class NetworkInterceptor {
    static init() {
      NetworkInterceptor.setupIdentityMock();
      NetworkInterceptor.setupFetchHook();
      NetworkInterceptor.setupXhrHook();
      NetworkInterceptor.setupPlayinfoHook();
      Logger.info('NetworkInterceptor pipeline mounted.');
    }

    // 注入訪客偽裝身分 Cookie 與 LocalStorage 預設畫質
    static setupIdentityMock() {
      try {
        if (!doc.cookie.includes(`${CONFIG.AUTH.COOKIE_KEY}=`)) {
          doc.cookie = `${CONFIG.AUTH.COOKIE_KEY}=${CONFIG.AUTH.FAKE_MID}; path=/; domain=.bilibili.com`;
        }
        const profile = JSON.parse(localStorage.getItem('bpx_player_profile') || '{}');
        if (!profile.media) profile.media = {};
        profile.media.quality = CONFIG.QUALITY.FHD_1080P;
        localStorage.setItem('bpx_player_profile', JSON.stringify(profile));
      } catch (e) {
        Logger.warn('Failed to setup identity mock storage:', e);
      }
    }

    /**
     * 請求 URL 改寫管線：平滑將 WBI 端點導向一般 Playurl，並附帶 1080P 與試看參數
     */
    static modifyRequestUrl(urlStr) {
      try {
        const parsed = new URL(urlStr, location.origin);
        if (parsed.pathname.includes(CONFIG.ROUTES.WBI_PLAYURL)) {
          parsed.pathname = parsed.pathname.replace(CONFIG.ROUTES.WBI_PLAYURL, CONFIG.ROUTES.CLEAN_PLAYURL);
        }
        parsed.searchParams.set('qn', String(CONFIG.QUALITY.FHD_1080P));
        parsed.searchParams.set('try_look', '1');
        parsed.searchParams.set('fourk', '1');
        parsed.searchParams.set('fnval', '4048');
        parsed.searchParams.set('fnver', '0');
        return parsed.toString();
      } catch (e) {
        return urlStr;
      }
    }

    /**
     * 響應數據淨化管線：注入 1080P DASH 資訊，並將用戶資訊偽裝為登入身分
     */
    static sanitizePayload(url, json) {
      if (!json || !json.data) return;
      const data = json.data;

      // 1. 處理 Playurl 串流清單
      if (url.includes('/playurl')) {
        data.quality = CONFIG.QUALITY.FHD_1080P;
        if (!data.accept_quality || !data.accept_quality.includes(CONFIG.QUALITY.FHD_1080P)) {
          data.accept_quality = CONFIG.QUALITY.ACCEPT_QUALITIES;
          data.accept_description = CONFIG.QUALITY.ACCEPT_DESCRIPTIONS;
        }
        Logger.info('Successfully injected 1080P (QN 80) DASH stream manifest.');
      }

      // 2. 處理 User Info (/x/player/v2) 訪客身分看門狗
      if (url.includes(CONFIG.ROUTES.USER_INFO_V2) || url.includes(CONFIG.ROUTES.USER_INFO_WBI_V2)) {
        data.login_mid = Number(CONFIG.AUTH.FAKE_MID);
        data.mid = Number(CONFIG.AUTH.FAKE_MID);
        if (data.level_info) {
          data.level_info.current_level = CONFIG.AUTH.FAKE_LEVEL;
        }
        Logger.info('Successfully spoofed /x/player/v2 identity. Guest quality threshold bypassed.');
      }
    }

    static setupFetchHook() {
      const origFetch = win.fetch;
      win.fetch = async function (...args) {
        let [resource, config] = args;
        let url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

        if (url && (url.includes(CONFIG.ROUTES.WBI_PLAYURL) || url.includes(CONFIG.ROUTES.CLEAN_PLAYURL))) {
          const newUrl = NetworkInterceptor.modifyRequestUrl(url);
          url = newUrl;
          if (typeof resource === 'string') {
            args[0] = newUrl;
          } else if (resource && resource.url) {
            args[0] = new Request(newUrl, config);
          }
        }

        const response = await origFetch.apply(this, args);
        try {
          if (url && (url.includes('/playurl') || url.includes(CONFIG.ROUTES.USER_INFO_V2) || url.includes(CONFIG.ROUTES.USER_INFO_WBI_V2))) {
            const clone = response.clone();
            const json = await clone.json();
            NetworkInterceptor.sanitizePayload(url, json);
            return new Response(JSON.stringify(json), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
          }
        } catch (e) {
          Logger.debug('Fetch interception parse bypass:', e);
        }
        return response;
      };
    }

    static setupXhrHook() {
      const origOpen = win.XMLHttpRequest.prototype.open;
      const origSend = win.XMLHttpRequest.prototype.send;

      win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (typeof url === 'string' && (url.includes(CONFIG.ROUTES.WBI_PLAYURL) || url.includes(CONFIG.ROUTES.CLEAN_PLAYURL))) {
          url = NetworkInterceptor.modifyRequestUrl(url);
        }
        this._biliUrl = url;
        return origOpen.call(this, method, url, ...rest);
      };

      win.XMLHttpRequest.prototype.send = function (...args) {
        if (this._biliUrl && (this._biliUrl.includes('/playurl') || this._biliUrl.includes(CONFIG.ROUTES.USER_INFO_V2) || this._biliUrl.includes(CONFIG.ROUTES.USER_INFO_WBI_V2))) {
          const onReady = () => {
            if (this.readyState === 4 && this.status === 200) {
              try {
                const data = JSON.parse(this.responseText);
                NetworkInterceptor.sanitizePayload(this._biliUrl, data);
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
    }

    static setupPlayinfoHook() {
      let currentPlayinfo = win.__playinfo__;
      if (currentPlayinfo && currentPlayinfo.data) {
        NetworkInterceptor.sanitizePayload('/playurl', currentPlayinfo);
      }

      HookManager.hookProperty(win, '__playinfo__', {
        get() {
          return currentPlayinfo;
        },
        set(val) {
          if (val && val.data) {
            NetworkInterceptor.sanitizePayload('/playurl', val);
          }
          currentPlayinfo = val;
        }
      });
    }
  }

  // =========================================================================
  // 6. 播放器生命週期與畫質控制器 (PlayerController)
  // =========================================================================
  class PlayerController {
    static isUserSwitching = false;
    static activePlayer = null;
    static hasPromotedSuccessfully = false;

    static init() {
      PlayerController.setupPlayerWatcher();
      Logger.info('PlayerController initialized.');
    }

    static setupPlayerWatcher() {
      let currentPlayer = win.player;
      if (currentPlayer) {
        PlayerController.bindPlayer(currentPlayer);
      }

      HookManager.hookProperty(win, 'player', {
        get() {
          return currentPlayer;
        },
        set(p) {
          currentPlayer = p;
          PlayerController.bindPlayer(p);
        }
      });

      // 守門人計時器：監視播放器就緒狀態與自適應畫質確保
      setInterval(() => {
        if (win.player && win.player !== PlayerController.activePlayer) {
          PlayerController.bindPlayer(win.player);
        }
        // 如果影片已在播放但尚未成功切換至 1080P，持續發起嘗試直到成功
        if (!PlayerController.hasPromotedSuccessfully && PlayerController.activePlayer) {
          const video = doc.querySelector('video');
          if (video && video.currentTime > 0.5) {
            PlayerController.promoteTo1080P();
          }
        }
      }, CONFIG.TIMING.WATCHDOG_INTERVAL_MS);
    }

    static bindPlayer(player) {
      if (!player || player.__1080pHooked) return;
      player.__1080pHooked = true;
      PlayerController.activePlayer = player;
      Logger.info('Official player instance bound. Managing quality controller...');

      // 1. 劫持 requestQuality: 阻止試看定時器觸發的非主動降級 (qn < 80)
      if (typeof player.requestQuality === 'function') {
        const origRequestQuality = player.requestQuality;
        player.requestQuality = (qn, ...args) => {
          if (qn < CONFIG.QUALITY.FHD_1080P && !PlayerController.isUserSwitching) {
            Logger.info(`Blocked automatic quality downgrade request (target QN: ${qn}). Keeping 1080P!`);
            return Promise.resolve();
          }
          return origRequestQuality.call(player, qn, ...args);
        };
      }

      // 2. 多階段觸發自動升級至 1080P
      setTimeout(() => {
        PlayerController.promoteTo1080P();
      }, CONFIG.TIMING.AUTO_PROMOTE_DELAY_MS);

      // 綁定 DOM Video 載入完成事件
      const attachVideoListeners = () => {
        const video = doc.querySelector('video');
        if (video) {
          video.addEventListener('loadeddata', () => PlayerController.promoteTo1080P(), { once: true });
          video.addEventListener('canplay', () => PlayerController.promoteTo1080P(), { once: true });
          video.addEventListener('play', () => PlayerController.promoteTo1080P(), { once: true });
        }
      };
      attachVideoListeners();
      if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', attachVideoListeners, { once: true });
      }
    }

    static promoteTo1080P() {
      if (!PlayerController.activePlayer || typeof PlayerController.activePlayer.requestQuality !== 'function') return;
      try {
        const qInfo = PlayerController.activePlayer.getQuality ? PlayerController.activePlayer.getQuality() : null;
        const currentQ = qInfo && typeof qInfo === 'object' ? (qInfo.realQ || qInfo.nowQ) : qInfo;

        if (currentQ === CONFIG.QUALITY.FHD_1080P) {
          PlayerController.hasPromotedSuccessfully = true;
          return;
        }

        Logger.info('Promoting stream quality to 1080P (QN 80)...');
        PlayerController.isUserSwitching = true;
        PlayerController.activePlayer.requestQuality(CONFIG.QUALITY.FHD_1080P)
          .then(() => {
            PlayerController.hasPromotedSuccessfully = true;
            Logger.info('Successfully switched to 1080P stream!');
          })
          .catch((err) => {
            Logger.warn('Quality promotion retry scheduled:', err);
          })
          .finally(() => {
            setTimeout(() => { PlayerController.isUserSwitching = false; }, 1000);
          });
      } catch (e) {
        Logger.error('Error in promoteTo1080P:', e);
      }
    }
  }

  // =========================================================================
  // 7. UI 與視覺防護員 (UIGuard)
  // =========================================================================
  class UIGuard {
    static init() {
      UIGuard.injectAntiDialogStyles();
      UIGuard.hookMiniLogin();
      UIGuard.hookPauseMethod();
      UIGuard.hookFullscreenExit();
      UIGuard.startMutationWatch();
      Logger.info('UIGuard mounted successfully.');
    }

    // 1. 樣式隱藏防線
    static injectAntiDialogStyles() {
      const apply = () => {
        const root = doc.head || doc.documentElement;
        if (root) {
          const style = doc.createElement('style');
          style.textContent = CONFIG.SELECTORS.LOGIN_MODALS.join(', ') + ' { display: none !important; visibility: hidden !important; pointer-events: none !important; opacity: 0 !important; z-index: -99999 !important; }';
          root.appendChild(style);
          return true;
        }
        return false;
      };

      if (!apply()) {
        if (doc.readyState === 'loading') {
          doc.addEventListener('DOMContentLoaded', apply, { once: true });
        }
        const timer = setInterval(() => {
          if (apply()) clearInterval(timer);
        }, 50);
      }
    }

    // 2. miniLogin API 阻斷
    static hookMiniLogin() {
      let currentMiniLogin = win.miniLogin;
      HookManager.hookProperty(win, 'miniLogin', {
        get() {
          return currentMiniLogin;
        },
        set(val) {
          if (val && typeof val === 'object') {
            if (typeof val.show === 'function') {
              val.show = () => {
                Logger.info('Blocked miniLogin.show() popup call!');
                return Promise.resolve();
              };
            }
            if (typeof val.regist === 'function') {
              val.regist = () => Promise.resolve();
            }
          }
          currentMiniLogin = val;
        }
      });
    }

    // 3. 攔截定時器引發的非主動 pause()
    static hookPauseMethod() {
      HookManager.hookMethod(win.HTMLVideoElement.prototype, 'pause', (origPause) => {
        return function (...args) {
          const isUserAction = UserIntentTracker.isRecentUserAction();
          const isVideoEnded = this.duration && (this.currentTime >= this.duration - 1);

          // 正常使用者操作或自然播畢放行
          if (isUserAction || isVideoEnded) {
            return origPause.apply(this, args);
          }

          Logger.info(`Blocked programmatic pause() from page timer (Progress: ${this.currentTime.toFixed(1)}s)!`);
          UIGuard.cleanModals();
          return;
        };
      });
    }

    // 4. 攔截定時器引發的強制退出全螢幕 exitFullscreen()
    static hookFullscreenExit() {
      const methods = ['exitFullscreen', 'webkitExitFullscreen', 'mozCancelFullScreen', 'msExitFullscreen'];
      const targets = [
        win.Document ? win.Document.prototype : null,
        doc,
        win.document
      ].filter(Boolean);

      targets.forEach((target) => {
        methods.forEach((method) => {
          if (typeof target[method] === 'function') {
            HookManager.hookMethod(target, method, (origMethod) => {
              return function (...args) {
                if (UserIntentTracker.isRecentUserAction()) {
                  Logger.info(`User initiated fullscreen exit (${UserIntentTracker.getLastActionType()}). Allowed.`);
                  return origMethod.apply(this, args);
                }
                Logger.info('Blocked programmatic exitFullscreen() call from page timer!');
                return Promise.resolve();
              };
            });
          }
        });
      });
    }

    // 5. DOM MutationObserver 即時清理
    static startMutationWatch() {
      const attach = () => {
        const root = doc.documentElement || doc.body;
        if (!root) return false;
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
                    Logger.info('MutationObserver destroyed a login modal popup instantly.');
                    const video = doc.querySelector('video');
                    if (video && video.paused) {
                      video.play().catch(() => {});
                    }
                  }
                }
              }
            }
          }
        });

        observer.observe(root, {
          childList: true,
          subtree: true
        });
        return true;
      };

      if (!attach()) {
        if (doc.readyState === 'loading') {
          doc.addEventListener('DOMContentLoaded', attach, { once: true });
        }
        const timer = setInterval(() => {
          if (attach()) clearInterval(timer);
        }, 50);
      }
    }

    static cleanModals() {
      CONFIG.SELECTORS.LOGIN_MODALS.forEach((sel) => {
        doc.querySelectorAll(sel).forEach((el) => el.remove());
      });
    }
  }

  // =========================================================================
  // 8. 應用啟動引導器 (Application Bootstrap)
  // =========================================================================
  class AppBootstrap {
    static run() {
      Logger.info(`Bootstrapping ${CONFIG.APP.NAME} v${CONFIG.APP.VERSION}...`);

      try {
        UserIntentTracker.init();
        NetworkInterceptor.init();
        UIGuard.init();
        PlayerController.init();

        // 開放除錯命名空間
        win.__BiliEngine__ = {
          CONFIG,
          Logger,
          UserIntentTracker,
          NetworkInterceptor,
          PlayerController,
          UIGuard
        };

        Logger.info('Engine initialized successfully in clean architecture mode.');
      } catch (err) {
        Logger.error('Fatal initialization error:', err);
      }
    }
  }

  // 立即啟動
  AppBootstrap.run();
})();
