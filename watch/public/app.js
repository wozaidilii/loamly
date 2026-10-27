/**
 * Loamly 私人放映厅 · 异地连麦同步播放器 (watch.loamly.cn)
 * Apple TV+ / MUBI / A24 高定私人放映厅交互 + 双端实时装片进度条 + HTTP Range 跨网流式中继 + WebRTC 连麦引擎
 */

(function () {
  'use strict';

  const CHUNK_SIZE = 64 * 1024;
  const BUFFER_THRESHOLD = 512 * 1024;
  const DUCK_TARGET_VOLUME = 0.25;
  const DUCK_ATTACK_MS = 200;
  const DUCK_RELEASE_DELAY_MS = 1000;

  // DOM 引用
  const wxGuideBanner = document.getElementById('wxGuideBanner');
  const wxGuideCloseBtn = document.getElementById('wxGuideCloseBtn');

  const lobbyEditionLabel = document.getElementById('lobbyEditionLabel');
  const roomHeaderActions = document.getElementById('roomHeaderActions');
  const roomCodeBadge = document.getElementById('roomCodeBadge');
  const copyInviteLinkBtn = document.getElementById('copyInviteLinkBtn');
  const copyInviteText = document.getElementById('copyInviteText');
  const openSettingsDrawerBtn = document.getElementById('openSettingsDrawerBtn');
  const closeSettingsDrawerBtn = document.getElementById('closeSettingsDrawerBtn');
  const settingsDrawerBackdrop = document.getElementById('settingsDrawerBackdrop');

  const homeView = document.getElementById('homeView');
  const roomView = document.getElementById('roomView');

  const localVideoFileInput = document.getElementById('localVideoFileInput');
  const selectVideoCreateBtn = document.getElementById('selectVideoCreateBtn');
  const quickDemoRoomBtn = document.getElementById('quickDemoRoomBtn');
  const joinRoomForm = document.getElementById('joinRoomForm');
  const roomCodeInput = document.getElementById('roomCodeInput');

  const mainMovieVideo = document.getElementById('mainMovieVideo');
  const startScreeningOverlay = document.getElementById('startScreeningOverlay');
  const curtainStatusBadge = document.getElementById('curtainStatusBadge');
  const curtainFilmTitle = document.getElementById('curtainFilmTitle');
  const curtainSubtext = document.getElementById('curtainSubtext');
  const curtainProgressWrap = document.getElementById('curtainProgressWrap');
  const curtainProgressFill = document.getElementById('curtainProgressFill');
  const curtainProgressMain = document.getElementById('curtainProgressMain');
  const curtainProgressDetail = document.getElementById('curtainProgressDetail');
  const curtainProgressTick = document.querySelector('.curtain-progress-tick');
  const startScreeningBtn = document.getElementById('startScreeningBtn');
  const startScreeningBtnText = document.getElementById('startScreeningBtnText');
  const guestQuickMatchBtn = document.getElementById('guestQuickMatchBtn');
  const curtainQualitySwitch = document.getElementById('curtainQualitySwitch');
  const qualityOriginalBtn = document.getElementById('qualityOriginalBtn');
  const qualityFast720Btn = document.getElementById('qualityFast720Btn');

  const theaterStage = document.getElementById('theaterStage');
  const duckingStatusToast = document.getElementById('duckingStatusToast');
  const voiceWaveBars = document.getElementById('voiceWaveBars');
  const toastActionBadge = document.getElementById('toastActionBadge');
  const duckingToastText = document.getElementById('duckingToastText');
  const peerTimelineCursor = document.getElementById('peerTimelineCursor');
  const liveSyncBadge = document.getElementById('liveSyncBadge');
  const liveSyncText = document.getElementById('liveSyncText');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const fullscreenSvg = document.getElementById('fullscreenSvg');

  const pipFloatingWindow = document.getElementById('pipFloatingWindow');
  const partnerSeatCard = document.getElementById('partnerSeatCard');
  const selfSeatCard = document.getElementById('selfSeatCard');
  const remoteCamVideo = document.getElementById('remoteCamVideo');
  const remotePortraitImg = document.getElementById('remotePortraitImg');
  const localCamVideo = document.getElementById('localCamVideo');
  const localPortraitImg = document.getElementById('localPortraitImg');
  const pipPeerLabel = document.getElementById('pipPeerLabel');
  const seatPartnerWave = document.getElementById('seatPartnerWave');
  const localCamFacingTag = document.getElementById('localCamFacingTag');

  const playPauseBtn = document.getElementById('playPauseBtn');
  const playPauseSvg = document.getElementById('playPauseSvg');
  const timelineSlider = document.getElementById('timelineSlider');
  const timeReadout = document.getElementById('timeReadout');
  const duckToggleBtn = document.getElementById('duckToggleBtn');
  const duckToggleLabel = document.getElementById('duckToggleLabel');
  const drawerDuckSwitchBtn = document.getElementById('drawerDuckSwitchBtn');
  const screenPauseOverlay = document.getElementById('screenPauseOverlay');
  const pauseOverlayTitle = document.getElementById('pauseOverlayTitle');
  const pauseOverlaySub = document.getElementById('pauseOverlaySub');
  const resumeFromPauseBtn = document.getElementById('resumeFromPauseBtn');
  const volumeMixerWrap = document.getElementById('volumeMixerWrap');
  const volumeMixerBtn = document.getElementById('volumeMixerBtn');
  const volumeMixerPopover = document.getElementById('volumeMixerPopover');
  const movieVolumeSlider = document.getElementById('movieVolumeSlider');
  const peerVolumeSlider = document.getElementById('peerVolumeSlider');
  const movieVolVal = document.getElementById('movieVolVal');
  const peerVolVal = document.getElementById('peerVolVal');
  const movieMuteBtn = document.getElementById('movieMuteBtn');
  const peerMuteBtn = document.getElementById('peerMuteBtn');
  const peerMuteHint = document.getElementById('peerMuteHint');
  const volumeMixerDot = document.getElementById('volumeMixerDot');
  const timelineLoadEdge = document.getElementById('timelineLoadEdge');
  const timelineHoverTip = document.getElementById('timelineHoverTip');
  const switchFilmConfirm = document.getElementById('switchFilmConfirm');
  const switchFilmConfirmOk = document.getElementById('switchFilmConfirmOk');
  const switchFilmConfirmCancel = document.getElementById('switchFilmConfirmCancel');
  const toggleMicBtn = document.getElementById('toggleMicBtn');

  // 抽屉内底层状态与控制元素
  const currentFileName = document.getElementById('currentFileName');
  const p2pProgressText = document.getElementById('p2pProgressText');
  const movieVolumeText = document.getElementById('movieVolumeText');
  const wakeLockText = document.getElementById('wakeLockText');
  const playbackRateSelect = document.getElementById('playbackRateSelect');
  const simulateSpeakBtn = document.getElementById('simulateSpeakBtn');
  const flipCamBtn = document.getElementById('flipCamBtn');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  const savedDuckPref = localStorage.getItem('loamly_ducking_v2');

  const state = window.__watchState = {
    ws: null,
    wsConnected: false,
    roomCode: null,
    clientId: null,
    role: 'host',
    peerCount: 1,
    selectedFile: null,
    filePickIntent: 'upload',
    fileMeta: null,
    sameFileMatched: false,
    instantSyncOverride: false,
    qualityMode: '720p',
    filmUploadAbortList: [],
    filmUploadXhr: null,
    filmTransfer: {
      active: false,
      ready: false,
      pct: 0,
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      streamUrl: null
    },
    localFilmReady: false,
    peerFilmReady: false,
    peerReadiness: {},
    pc: null,
    pendingIceCandidates: [],
    makingOffer: false,
    hasCompletedInitialHandshake: false,
    localCameraPromise: null,
    fileChannel: null,
    localStream: null,
    remoteStream: null,
    micEnabled: true,
    camEnabled: true,
    facingMode: 'user',
    wakeLockSentinel: null,
    duckingEnabled: false,
    isSpeaking: false,
    simulatedSpeaking: false,
    lastVoiceTimestamp: 0,
    userMovieVolume: 1.0,
    userPeerVolume: 1.0,
    currentVolume: 1.0,
    targetVolume: 1.0,
    remoteGainNode: null,
    lastPlayheadTime: 0,
    lastPlayheadMovedAt: Date.now(),
    audioCtx: null,
    localAnalyser: null,
    remoteAnalyser: null,
    suppressSyncEmit: false,
    hasStartedScreening: false,
    isLocalBuffering: false,
    isPeerBuffering: false,
    pausedForPeerBuffering: false,
    bufferingTimer: null,
    actionToastTimer: null,
    actionToastPersistent: false,
    lastHardSyncAt: 0,
    basePlaybackRate: 1.0,
    peerPlayback: {
      currentTime: 0,
      playing: false,
      playbackRate: 1.0,
      updatedAt: 0
    },
    receivingMeta: null,
    receivingChunks: [],
    receivedBytes: 0,
    receiveStartTime: 0,
    mediaSource: null,
    sourceBuffer: null,
    mseQueue: [],
    myUploadId: null,
    myUploadInfo: null,
    uploadEngine: null,
    filmDuration: 0,
    timelinePlayedPct: 0,
    movieVolPct: 100,
    peerVolPct: 100,
    movieMuted: false,
    peerMuted: false,
    preMuteMovieVolPct: 100,
    preMutePeerVolPct: 100,
    autoPausedForLoading: false,
    loadingPauseSuppressUntil: 0,
    peerBufferingSince: 0,
    peerWaitSkipOffered: false,
    lastPriorityRequestAt: 0,
    remoteStallSince: 0,
    remoteStallReloads: 0,
    streamResume: null,
    streamReloadSeq: 0,
    lastGoodRemoteTime: 0,
    lastLoadingToastAt: 0
  };

  // 进度条三段：已播放（香槟金）/ 已装入未播放 / 还没装入。已装入按两边较少的一方算（上传方传到哪，两边就都能播到哪）
  function getLoadedRangesPct() {
    const ft = state.filmTransfer || {};
    const isDemo = Boolean(state.fileMeta && state.fileMeta.isDemo);
    if (state.sameFileMatched || isDemo || ft.ready || !ft.active) {
      return { ranges: [[0, 100]], loading: false };
    }
    const total = ft.totalBytes || (state.fileMeta && state.fileMeta.size) || 0;
    if (!total) return { ranges: [], loading: true };
    const raw = (Array.isArray(ft.ranges) && ft.ranges.length)
      ? ft.ranges
      : (ft.contiguousBytes ? [[0, ft.contiguousBytes]] : []);
    const ranges = raw
      .map((r) => [Math.max(0, (r[0] / total) * 100), Math.min(100, (r[1] / total) * 100)])
      .filter((r) => r[1] > r[0])
      .sort((a, b) => a[0] - b[0]);
    return { ranges, loading: true };
  }

  function renderTimelineTrack() {
    if (!timelineSlider) return;
    const p = Math.max(0, Math.min(100, Number(state.timelinePlayedPct) || 0));
    const { ranges, loading } = getLoadedRangesPct();
    const PLAYED = 'var(--champagne, #D6B485)';
    const LOADED = 'rgba(255, 255, 255, 0.38)';
    const EMPTY = 'rgba(255, 255, 255, 0.16)';
    const f = (v) => `${v.toFixed(2)}%`;
    const stops = [`${PLAYED} 0%`, `${PLAYED} ${f(p)}`];
    let x = p;
    for (const [a0, b0] of ranges) {
      if (b0 <= x) continue;
      const a = Math.max(a0, x);
      if (a > x) stops.push(`${EMPTY} ${f(x)}`, `${EMPTY} ${f(a)}`);
      stops.push(`${LOADED} ${f(a)}`, `${LOADED} ${f(b0)}`);
      x = b0;
    }
    if (x < 100) stops.push(`${EMPTY} ${f(x)}`, `${EMPTY} 100%`);
    timelineSlider.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;

    if (timelineLoadEdge) {
      let edge = -1;
      if (loading) {
        const cover = ranges.find((r) => p >= r[0] && p <= r[1]);
        if (cover) edge = cover[1];
        else if (ranges.length && ranges[0][0] <= 0.01) edge = ranges[0][1];
        else edge = 0;
      }
      if (loading && edge >= 0 && edge < 99.9) {
        timelineLoadEdge.style.left = `${edge.toFixed(2)}%`;
        timelineLoadEdge.classList.remove('hidden');
      } else {
        timelineLoadEdge.classList.add('hidden');
      }
    }
  }

  function isTimelinePctLoaded(pct) {
    const { ranges } = getLoadedRangesPct();
    return ranges.some((r) => pct >= r[0] && pct <= r[1]);
  }

  function refreshTimelineTrack() {
    renderTimelineTrack();
  }

  function updateSliderProgressTrack(pct) {
    state.timelinePlayedPct = Math.max(0, Math.min(100, Number(pct) || 0));
    renderTimelineTrack();
  }

  // 播放头前方还有多少秒已经装好（只在边传边播时有意义；本地/已装完返回 Infinity）
  function getLoadedAheadSec(timeSec) {
    const ft = state.filmTransfer || {};
    const dur = mainMovieVideo.duration || ft.duration || state.filmDuration || 0;
    const total = ft.totalBytes || 0;
    if (!ft.active || ft.ready || state.sameFileMatched || !(dur > 0) || !(total > 0)) return Infinity;
    const b = (timeSec / dur) * total;
    const raw = (Array.isArray(ft.ranges) && ft.ranges.length) ? ft.ranges : [[0, ft.contiguousBytes || 0]];
    for (const r of raw) {
      if (b >= r[0] && b < r[1]) {
        if (r[1] >= total) return Infinity;
        return (r[1] / total) * dur - timeSec;
      }
    }
    return 0;
  }

  // 估算还要多久能从 timeSec 往后连续装够 aheadSec 秒
  function estimateLoadEtaSec(timeSec, aheadSec = 20) {
    const ft = state.filmTransfer || {};
    const dur = mainMovieVideo.duration || ft.duration || state.filmDuration || 0;
    const total = ft.totalBytes || 0;
    const speed = ft.speedBps || 0;
    if (!(dur > 0) || !(total > 0) || !(speed > 0)) return 0;
    const ahead = getLoadedAheadSec(timeSec);
    if (ahead === Infinity || ahead >= aheadSec) return 0;
    const need = (aheadSec - Math.max(0, ahead)) * (total / dur);
    return Math.max(1, Math.ceil(need / speed));
  }

  function loadingWaitText(etaSec) {
    return etaSec > 0
      ? `这段影片还在装入 · 大约 ${etaSec} 秒后两边一起继续`
      : '这段影片还在装入 · 好了会自动继续';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${mb.toFixed(1)} MB`;
  }

  function formatSpeedEta(receivedBytes, totalBytes, speedBps) {
    const sizePart = totalBytes > 0 ? `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}` : formatBytes(receivedBytes);
    if (!speedBps || speedBps <= 0) return sizePart;
    const speedMb = (speedBps / (1024 * 1024)).toFixed(1);
    const remainBytes = Math.max(0, (totalBytes || 0) - (receivedBytes || 0));
    const etaSec = speedBps > 0 ? Math.ceil(remainBytes / speedBps) : 0;
    if (etaSec > 0 && etaSec < 3600) {
      return `${sizePart} · ${speedMb} MB/s · 约剩 ${etaSec}s`;
    }
    return `${sizePart} · ${speedMb} MB/s`;
  }

  function formatCinemaTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }


  function showSharePlayActionToast(icon, text, options = {}) {
    if (!duckingStatusToast || !duckingToastText) return;
    const persistent = Boolean(options.persistent);
    const durationMs = options.durationMs || 2600;

    if (state.actionToastTimer) {
      clearTimeout(state.actionToastTimer);
      state.actionToastTimer = null;
    }
    state.actionToastPersistent = persistent;
    if (typeof options.onClick === 'function') {
      const handler = options.onClick;
      duckingStatusToast.onclick = (e) => {
        e.stopPropagation();
        duckingStatusToast.onclick = null;
        duckingStatusToast.classList.remove('is-clickable');
        handler();
      };
      duckingStatusToast.classList.add('is-clickable');
    } else {
      duckingStatusToast.onclick = null;
      duckingStatusToast.classList.remove('is-clickable');
    }

    if (voiceWaveBars) voiceWaveBars.classList.add('hidden');
    if (toastActionBadge) {
      toastActionBadge.textContent = icon || '●';
      toastActionBadge.classList.remove('hidden');
    }
    duckingToastText.textContent = text;
    duckingToastText.classList.remove('hidden');
    duckingStatusToast.classList.add('is-action-toast');
    duckingStatusToast.classList.remove('silent');

    if (!persistent) {
      state.actionToastTimer = setTimeout(() => {
        state.actionToastTimer = null;
        state.actionToastPersistent = false;
        if (!state.isSpeaking) {
          duckingStatusToast.classList.add('silent');
          duckingStatusToast.classList.remove('is-action-toast');
          if (toastActionBadge) toastActionBadge.classList.add('hidden');
          if (voiceWaveBars) voiceWaveBars.classList.remove('hidden');
        }
      }, durationMs);
    }
  }

  function clearPersistentActionToast() {
    if (!state.actionToastPersistent) return;
    state.actionToastPersistent = false;
    if (state.actionToastTimer) {
      clearTimeout(state.actionToastTimer);
      state.actionToastTimer = null;
    }
    if (duckingStatusToast) {
      duckingStatusToast.onclick = null;
      duckingStatusToast.classList.remove('is-clickable');
    }
    if (!state.isSpeaking && duckingStatusToast) {
      duckingStatusToast.classList.add('silent');
      duckingStatusToast.classList.remove('is-action-toast');
      if (toastActionBadge) toastActionBadge.classList.add('hidden');
      if (voiceWaveBars) voiceWaveBars.classList.remove('hidden');
    }
  }

  function getEstimatedPeerCurrentTime() {
    const p = state.peerPlayback;
    if (!p || !p.updatedAt) return mainMovieVideo.currentTime || 0;
    if (!p.playing || state.isPeerBuffering) return p.currentTime || 0;
    const elapsedSec = Math.max(0, Math.min(3.0, (Date.now() - p.updatedAt) / 1000));
    return (p.currentTime || 0) + elapsedSec * (p.playbackRate || 1);
  }

  function updateLiveSyncUI() {
    const dur = mainMovieVideo.duration || 0;
    const myTime = mainMovieVideo.currentTime || 0;

    if (peerTimelineCursor) {
      if (state.peerCount >= 2 && dur > 0 && state.peerPlayback.updatedAt > 0) {
        const peerTime = Math.max(0, Math.min(dur, getEstimatedPeerCurrentTime()));
        const peerPct = (peerTime / dur) * 100;
        peerTimelineCursor.style.left = `${peerPct.toFixed(2)}%`;
        peerTimelineCursor.title = `TA 的播放位置：${formatCinemaTime(peerTime)}`;
        peerTimelineCursor.classList.remove('hidden');
      } else {
        peerTimelineCursor.classList.add('hidden');
      }
    }

    if (!liveSyncBadge || !liveSyncText) return;

    liveSyncBadge.classList.remove('is-live', 'is-drifted', 'is-waiting');

    if (state.peerCount < 2) {
      liveSyncBadge.classList.add('is-waiting');
      liveSyncText.textContent = '等待入座';
      liveSyncBadge.title = 'TA 进来后开始同步';
      return;
    }

    if (state.isLocalBuffering) {
      liveSyncBadge.classList.add('is-drifted');
      liveSyncText.textContent = '画面加载中…';
      liveSyncBadge.title = '正在加载画面，TA 已停下等你';
      return;
    }

    if (state.isPeerBuffering) {
      liveSyncBadge.classList.add('is-drifted');
      liveSyncText.textContent = '正在等 TA';
      liveSyncBadge.title = 'TA 那边正在加载画面，已自动停下等 TA';
      return;
    }

    if (!state.peerPlayback.updatedAt) {
      liveSyncBadge.classList.add('is-live');
      liveSyncText.textContent = '已同步';
      return;
    }

    const peerTime = getEstimatedPeerCurrentTime();
    const drift = Math.abs(myTime - peerTime);

    if (drift <= 1.2) {
      liveSyncBadge.classList.add('is-live');
      liveSyncText.textContent = '已同步';
      liveSyncBadge.title = `已同步（你 ${formatCinemaTime(myTime)} · TA ${formatCinemaTime(peerTime)}）`;
    } else {
      liveSyncBadge.classList.add('is-drifted');
      const diffSec = Math.max(1, Math.round(drift));
      liveSyncText.textContent = `↻ 差 ${diffSec}s · 点此追平`;
      liveSyncBadge.title = `点击立即对齐到 TA 的当前画面（${formatCinemaTime(peerTime)}）`;
    }
  }

  function toggleCinemaFullscreen() {
    const targetEl = roomView || theaterStage || mainMovieVideo;
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;

    if (isFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      return;
    }

    if (targetEl && targetEl.requestFullscreen) {
      targetEl.requestFullscreen().catch(() => {
        if (mainMovieVideo && mainMovieVideo.webkitEnterFullscreen) {
          mainMovieVideo.webkitEnterFullscreen();
        }
      });
    } else if (targetEl && targetEl.webkitRequestFullscreen) {
      targetEl.webkitRequestFullscreen();
    } else if (mainMovieVideo && mainMovieVideo.webkitEnterFullscreen) {
      mainMovieVideo.webkitEnterFullscreen();
    }
  }

  function updateFullscreenIcon() {
    if (!fullscreenSvg) return;
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      fullscreenSvg.innerHTML = '<path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>';
    } else {
      fullscreenSvg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M21 8V5a2 2 0 0 0-2-2h-3"></path><path d="M3 16v3a2 2 0 0 0 2 2h3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>';
    }
  }

  function setCurtainVisible(visible) {
    if (!startScreeningOverlay) return;
    if (visible) {
      startScreeningOverlay.classList.remove('hidden-curtain');
    } else {
      startScreeningOverlay.classList.add('hidden-curtain');
      state.hasStartedScreening = true;
    }
  }

  function syncPeerReadinessMap(peerReadiness) {
    if (!peerReadiness || typeof peerReadiness !== 'object') return;
    state.peerReadiness = peerReadiness;
    let otherReady = false;
    for (const [id, info] of Object.entries(peerReadiness)) {
      if (id !== state.clientId && info && info.filmReady) {
        otherReady = true;
      }
    }
    state.peerFilmReady = otherReady;
  }

  function safePlayMovieVideo() {
    const p = mainMovieVideo.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        mainMovieVideo.muted = true;
        mainMovieVideo.play().then(() => {
          showSharePlayActionToast('🔇', '已开始 · 点一下开声音', { persistent: true });
          const unmuteOnce = () => {
            mainMovieVideo.muted = Boolean(state.movieMuted || state.userMovieVolume === 0);
            clearPersistentActionToast();
            document.removeEventListener('click', unmuteOnce);
            document.removeEventListener('touchstart', unmuteOnce);
          };
          document.addEventListener('click', unmuteOnce, { once: true });
          document.addEventListener('touchstart', unmuteOnce, { once: true });
        }).catch(() => {});
      });
    }
  }

  // 开映卡片底部的灰色小字「其他方式」→ 点开才出现「用我自己电脑里的同一部片」
  function setOtherWaysVisible(show) {
    const wrap = document.getElementById('curtainOtherWays');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !show);
    if (!show) {
      state.otherWaysOpen = false;
      if (guestQuickMatchBtn) guestQuickMatchBtn.classList.add('hidden');
      const link = document.getElementById('otherWaysLink');
      if (link) { link.classList.remove('hidden'); link.setAttribute('aria-expanded', 'false'); }
    }
  }

  function isScreeningReadyToStart() {
    if (!state.localFilmReady) return false;
    if (state.sameFileMatched || state.instantSyncOverride) return true;
    if (state.fileMeta && state.fileMeta.isDemo) return true;
    const startReady = Boolean(state.filmTransfer.ready || state.filmTransfer.streamReady);
    if (state.filmTransfer.active && !startReady) return false;
    if (state.peerCount >= 2 && !state.peerFilmReady) return false;
    return true;
  }

  // 统一刷新银幕中央「装片进度条 + 开始同步放映按钮锁定态 + 伴侣落座状态」
  function updateCurtainAndReadinessUI() {
    const code = state.roomCode || '3G6H';
    const hasFilmMeta = Boolean(state.fileMeta && state.fileMeta.name);
    const isDemo = Boolean(state.fileMeta && state.fileMeta.isDemo);
    const transferring = Boolean(state.filmTransfer.active && !state.filmTransfer.ready && !state.sameFileMatched && !isDemo);
    const pct = Math.max(0, Math.min(100, Number(state.filmTransfer.pct) || 0));

    // 1. 顶部场次状态徽章与右侧坐席标签
    if (state.peerCount >= 2) {
      if (curtainStatusBadge) {
        curtainStatusBadge.textContent = `NO. ${code} · TA 进来了 (2/2)`;
      }
      if (!state.isSpeaking) {
        pipPeerLabel.textContent = '';
      }
    } else {
      if (curtainStatusBadge) {
        curtainStatusBadge.textContent = `NO. ${code} · 等 TA 进来 (1/2)`;
      }
      if (!state.isSpeaking) {
        pipPeerLabel.textContent = '';
      }
    }

    // 2. 片名标题
    if (curtainFilmTitle) {
      if (hasFilmMeta) {
        curtainFilmTitle.textContent = state.fileMeta.name;
      } else {
        curtainFilmTitle.textContent = state.role === 'host' ? '选一个视频' : '等房主选视频…';
      }
    }

    const isUploaderSide = Boolean(state.selectedFile) || Boolean(state.myUploadId) || (state.role === 'host' && !transferring);
    if (curtainQualitySwitch) {
      if (isUploaderSide && (transferring || (hasFilmMeta && !isDemo && !state.hasStartedScreening))) {
        curtainQualitySwitch.classList.remove('hidden');
      } else {
        curtainQualitySwitch.classList.add('hidden');
      }
    }

    // 「提前开始」门槛：索引已装入 + 开头连续约 2 分钟（由上传方按码率换算后标记 streamReady）
    const fivePctStreamReady = Boolean(state.filmTransfer.ready || state.filmTransfer.streamReady);
    const bothSidesReady = Boolean(
      state.localFilmReady &&
      fivePctStreamReady &&
      (state.peerCount < 2 || state.peerFilmReady || state.sameFileMatched || state.instantSyncOverride || isDemo)
    );

    // 3. 细金线进度条与免传入口
    if (transferring) {
      if (curtainProgressWrap) curtainProgressWrap.classList.remove('hidden');
      if (curtainProgressFill) curtainProgressFill.style.width = `${pct}%`;
      const ftTotal = state.filmTransfer.totalBytes || (state.fileMeta && state.fileMeta.size) || 0;
      const ftStart = state.filmTransfer.startBytes || 0;
      if (curtainProgressTick) {
        if (ftTotal > 0 && ftStart > 0 && !fivePctStreamReady) {
          curtainProgressTick.style.left = `${Math.min(100, (ftStart / ftTotal) * 100).toFixed(2)}%`;
          curtainProgressTick.classList.remove('hidden');
        } else {
          curtainProgressTick.classList.add('hidden');
        }
      }

      let mainLabel = '';
      if (bothSidesReady) {
        mainLabel = '可以开场了 · 放映中会自动装完剩余影片';
      } else if (fivePctStreamReady) {
        mainLabel = !state.localFilmReady ? '正在准备画面…' : '正在为 TA 准备画面…';
      } else if (isUploaderSide) {
        const contig = state.filmTransfer.contiguousBytes || 0;
        const speed = state.filmTransfer.speedBps || 0;
        const remainBytes = Math.max(0, (ftStart || 0) - contig);
        const remainSec = speed > 0 && ftStart > 0 ? Math.max(1, Math.ceil(remainBytes / speed)) : 0;
        mainLabel = remainSec > 0
          ? `正在装入影片 · 开头还差 ${remainSec} 秒就能先开映`
          : '正在装入影片 · 开头装好就能先开映';
      } else {
        mainLabel = '正在为 TA 准备画面…';
      }
      if (curtainProgressMain) curtainProgressMain.textContent = mainLabel;

      const detailLabel = formatSpeedEta(
        state.filmTransfer.receivedBytes,
        state.filmTransfer.totalBytes || (state.fileMeta && state.fileMeta.size) || 0,
        state.filmTransfer.speedBps
      );
      if (curtainProgressDetail) curtainProgressDetail.textContent = detailLabel;
      p2pProgressText.textContent = `${mainLabel} (${detailLabel})`;

      if (curtainSubtext) {
        if (bothSidesReady) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        } else if (fivePctStreamReady) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        } else {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      }

      setOtherWaysVisible(!isUploaderSide && !state.sameFileMatched);
    } else {
      if (curtainProgressWrap) curtainProgressWrap.classList.add('hidden');
      setOtherWaysVisible(!isUploaderSide && hasFilmMeta && !isDemo && !state.sameFileMatched && !isScreeningReadyToStart());

      if (!hasFilmMeta) {
        if (curtainSubtext) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      } else if (state.sameFileMatched) {
        if (curtainSubtext) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      } else if (state.peerCount >= 2 && !state.peerFilmReady && !isDemo) {
        if (curtainSubtext) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      } else if (state.peerCount >= 2) {
        if (curtainSubtext) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      } else {
        if (curtainSubtext) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      }
    }

    // 4. 「一起开始放映」按钮严格锁定与文案
    if (startScreeningBtn && startScreeningBtnText) {
      if (!hasFilmMeta) {
        startScreeningBtn.disabled = false;
        startScreeningBtn.classList.remove('is-locked');
        startScreeningBtnText.textContent = '选择本地影片';
      } else if (state.instantSyncOverride || state.sameFileMatched || isDemo) {
        startScreeningBtn.disabled = false;
        startScreeningBtn.classList.remove('is-locked');
        startScreeningBtnText.textContent = '一起开始放映';
      } else if (transferring && !fivePctStreamReady) {
        startScreeningBtn.disabled = true;
        startScreeningBtn.classList.add('is-locked');
        startScreeningBtnText.textContent = '再等一会儿就能先开始';
      } else if (!state.localFilmReady && (mainMovieVideo.getAttribute('data-stream-url') || state.selectedFile || fivePctStreamReady)) {
        startScreeningBtn.disabled = true;
        startScreeningBtn.classList.add('is-locked');
        startScreeningBtnText.textContent = '正在对齐双方画面…';
      } else if (!state.localFilmReady) {
        startScreeningBtn.disabled = false;
        startScreeningBtn.classList.remove('is-locked');
        startScreeningBtnText.textContent = '选择本地影片';
      } else if (state.peerCount >= 2 && !state.peerFilmReady) {
        startScreeningBtn.disabled = true;
        startScreeningBtn.classList.add('is-locked');
        startScreeningBtnText.textContent = '正在对齐双方画面…';
      } else {
        startScreeningBtn.disabled = false;
        startScreeningBtn.classList.remove('is-locked');
        startScreeningBtnText.textContent = '一起开始放映';
      }
    }
  }

  function updateRoomPeerStatusUI() {
    updateCurtainAndReadinessUI();
  }

  function updateDuckingSwitchUI() {
    const on = state.duckingEnabled;
    if (duckToggleBtn) {
      duckToggleBtn.classList.toggle('is-on', on);
      duckToggleBtn.setAttribute('aria-checked', String(on));
    }
    if (duckToggleLabel) {
      duckToggleLabel.textContent = on ? '说话压音 · 开' : '说话压音 · 关';
    }
    if (drawerDuckSwitchBtn) {
      drawerDuckSwitchBtn.classList.toggle('is-on', on);
      drawerDuckSwitchBtn.setAttribute('aria-checked', String(on));
    }
  }

  // 1. 微信内置浏览器检测
  function checkWeChatBrowser() {
    const ua = navigator.userAgent || '';
    const params = new URLSearchParams(window.location.search);
    if (/MicroMessenger/i.test(ua) || params.get('wx') === '1') {
      wxGuideBanner.classList.remove('hidden');
    }
    wxGuideCloseBtn.addEventListener('click', () => {
      wxGuideBanner.classList.add('hidden');
    });
  }

  // 2. 屏幕常亮锁 (Screen Wake Lock)
  async function requestScreenWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockText.textContent = '已锁定常亮';
        return;
      } catch {}
    }
    wakeLockText.textContent = '已开启';
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.roomCode) {
      requestScreenWakeLock();
    }
  });

  // 3. WebSocket 房间信令
  function connectWebSocket(onReadyCallback) {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      if (state.ws.readyState === WebSocket.OPEN && onReadyCallback) onReadyCallback();
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.addEventListener('open', () => {
      state.wsConnected = true;
      if (state.wsPingTimer) clearInterval(state.wsPingTimer);
      state.wsPingTimer = setInterval(() => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          sendSignal({ type: 'ping' });
        }
      }, 15000);
      if (onReadyCallback) onReadyCallback();
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg);
      } catch {}
    });

    ws.addEventListener('close', () => {
      state.wsConnected = false;
      setTimeout(() => {
        if (state.roomCode) {
          connectWebSocket(() => {
            sendSignal({
              type: 'join_room',
              roomCode: state.roomCode,
              fileMeta: state.selectedFile ? state.fileMeta : (state.fileMeta && state.fileMeta.isDemo ? state.fileMeta : null),
              hasLocalFile: Boolean(state.selectedFile),
              ...queueIdentity()
            });
          });
        }
      }, 2000);
    });
  }

  function sendSignal(payload) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(payload));
    }
  }

  function markLocalFilmReady(ready) {
    state.localFilmReady = Boolean(ready);
    sendSignal({
      type: 'peer_film_ready',
      ready: state.localFilmReady
    });
    updateCurtainAndReadinessUI();
  }

  // 边缘直传地址（本机 127.0.0.1 调试时可用 localStorage 指向本地 Worker，线上始终走 edge-watch.loamly.net）
  const EDGE_R2_BASE = (() => {
    try {
      const h = window.location.hostname;
      if (h === '127.0.0.1' || h === 'localhost') {
        const o = localStorage.getItem('loamly_edge_base_test');
        if (o) return o;
      }
    } catch {}
    return 'https://edge-watch.loamly.net';
  })();

  function isEdgeStreamUrl(u) {
    return Boolean(u) && String(u).includes('/api/edge-film');
  }

  async function probeEdgeR2Available() {
    if (EDGE_R2_BASE === 'off') return false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${EDGE_R2_BASE}/api/ping`, { mode: 'cors', signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async function detectMp4HeadMoov(file) {
    try {
      const headSlice = file.slice(0, Math.min(file.size, 64 * 1024));
      const buf = await headSlice.arrayBuffer();
      const view = new DataView(buf);
      let pos = 0;
      while (pos + 8 <= view.byteLength) {
        let boxSize = view.getUint32(pos);
        const typeCode = String.fromCharCode(
          view.getUint8(pos + 4),
          view.getUint8(pos + 5),
          view.getUint8(pos + 6),
          view.getUint8(pos + 7)
        );
        if (typeCode === 'moov') return true;
        if (typeCode === 'mdat') return false;
        if (boxSize === 1 && pos + 16 <= view.byteLength) {
          const hi = view.getUint32(pos + 8);
          const lo = view.getUint32(pos + 12);
          boxSize = hi * 4294967296 + lo;
        }
        if (boxSize < 8) break;
        pos += boxSize;
      }
    } catch {}
    return false;
  }

  // 找到 MP4 索引（moov）在文件中的真实位置：逐个读顶层 box 头（每次只读 16 字节）
  async function findMp4MoovRange(file) {
    try {
      let pos = 0;
      let guard = 0;
      while (pos + 8 <= file.size && guard++ < 64) {
        const buf = await file.slice(pos, Math.min(file.size, pos + 16)).arrayBuffer();
        if (buf.byteLength < 8) break;
        const v = new DataView(buf);
        let size = v.getUint32(0);
        const type = String.fromCharCode(v.getUint8(4), v.getUint8(5), v.getUint8(6), v.getUint8(7));
        if (size === 1 && buf.byteLength >= 16) {
          size = v.getUint32(8) * 4294967296 + v.getUint32(12);
        } else if (size === 0) {
          size = file.size - pos;
        }
        if (type === 'moov') return { start: pos, end: Math.min(file.size, pos + size) };
        if (size < 8) break;
        pos += size;
      }
    } catch {}
    return null;
  }

  // 读取本地影片时长（用于「开头 2 分钟」开映门槛）
  function readLocalFilmDuration(file) {
    return new Promise((resolve) => {
      if (
        state.selectedFile === file &&
        !mainMovieVideo.getAttribute('data-stream-url') &&
        isFinite(mainMovieVideo.duration) && mainMovieVideo.duration > 0
      ) {
        resolve(mainMovieVideo.duration);
        return;
      }
      let finished = false;
      let url = null;
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const finish = (d) => {
        if (finished) return;
        finished = true;
        try { v.removeAttribute('src'); v.load(); } catch {}
        if (url) { try { URL.revokeObjectURL(url); } catch {} }
        resolve(d > 0 && isFinite(d) ? d : 0);
      };
      v.addEventListener('loadedmetadata', () => finish(v.duration));
      v.addEventListener('error', () => finish(0));
      setTimeout(() => finish(0), 10000);
      try {
        url = URL.createObjectURL(file);
        v.src = url;
      } catch {
        finish(0);
      }
    });
  }

  // 「提前开始」门槛：开头连续装入约 2 分钟影片；拿不到时长时退回 max(5%, 32MB)
  function computeStartBytes(totalSize, durationSec) {
    const total = Number(totalSize) || 0;
    if (total <= 0) return 1048576;
    const dur = Number(durationSec) || 0;
    const need = dur > 0
      ? Math.ceil((Math.min(120, dur) / dur) * total)
      : Math.max(Math.ceil(total * 0.05), 32 * 1024 * 1024);
    return Math.min(total, Math.max(1048576, need));
  }

  function resumeRecordKey(room) {
    return `loamly_upload_${room}`;
  }

  function saveResumeRecord(info) {
    try { localStorage.setItem(resumeRecordKey(info.room), JSON.stringify(info)); } catch {}
  }

  function loadResumeRecord(room) {
    try {
      const r = JSON.parse(localStorage.getItem(resumeRecordKey(room)) || 'null');
      return r && r.uploadId ? r : null;
    } catch {
      return null;
    }
  }

  function fileMatchesUploadRecord(file, rec) {
    return Boolean(
      rec && file &&
      rec.name === file.name &&
      Number(rec.size) === Number(file.size) &&
      (!rec.lastModified || !file.lastModified || Number(rec.lastModified) === Number(file.lastModified))
    );
  }

  function stopMyUpload() {
    if (state.uploadEngine) {
      try { state.uploadEngine.stop(); } catch {}
      state.uploadEngine = null;
    }
    state.myUploadId = null;
    state.UploadPriorityEnqueue = null;
  }

  // 房主选片后优先通过 Cloudflare R2 边缘直传，网络受限时自动回退房间直传。
  // 关键点：
  //  · 只认自己的 myUploadId，别人的进度广播绝不会让自己的上传停下；
  //  · 每块 90 秒超时、失败按 1s→10s 退避无限重试、30 秒无进展自动重发；
  //  · 拖动进度条 / TA 卡住时，落点开始连续 8 块最高优先，然后从落点往后顺序装，最后补前面的空档；
  //  · 重新选同一部片时，跳过已经装好的部分接着装。
  function uploadHostFilmToRoom(file, forceRestart = false, resumeInfo = null) {
    if (!file || !state.roomCode) return;

    // WebSocket 重连收到 room_joined 时不打断正在上传或已传完的同一部影片，只重新报一次进度
    if (
      !forceRestart &&
      state.uploadingFileRef === file &&
      state.myUploadId &&
      state.uploadEngine &&
      (state.filmTransfer.active || state.filmTransfer.ready)
    ) {
      if (typeof state.uploadEngine.announce === 'function') state.uploadEngine.announce(true);
      return;
    }

    stopMyUpload();

    state.uploadingFileRef = file;
    state.role = 'host';
    const uploadId = (resumeInfo && resumeInfo.uploadId) || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.myUploadId = uploadId;
    state.currentUploadId = uploadId;
    registerQueueFile(uploadId, file);
    if (state.bgUpload && state.bgUpload.itemId === uploadId) stopBackgroundUpload();
    if (!resumeInfo) state.peerFilmReady = false;
    state.autoPausedForLoading = false;
    state.filmTransfer = {
      active: true,
      ready: false,
      preloadReady: false,
      streamReady: false,
      pct: 0,
      receivedBytes: 0,
      contiguousBytes: 0,
      totalBytes: file.size,
      speedBps: 0,
      streamUrl: null,
      ranges: [],
      duration: 0,
      startBytes: 0
    };
    if (!(resumeInfo && state.hasStartedScreening)) setCurtainVisible(true);
    updateCurtainAndReadinessUI();

    const engine = {
      stopped: false,
      inflight: new Map(),
      announce: null,
      stop() {
        this.stopped = true;
        for (const e of this.inflight.values()) {
          e.reason = 'stop';
          try { e.xhr.abort(); } catch {}
        }
      }
    };
    state.uploadEngine = engine;
    const alive = () => !engine.stopped && state.myUploadId === uploadId && state.uploadEngine === engine;

    const durationPromise = readLocalFilmDuration(file);
    (async () => {
      let useEdgeR2;
      if (resumeInfo && typeof resumeInfo.edge === 'boolean') {
        useEdgeR2 = resumeInfo.edge; // 续传必须写回原来的存储位置
      } else {
        useEdgeR2 = await probeEdgeR2Available();
      }
      const [moovRange, hasHeadMoovFlag] = await Promise.all([findMp4MoovRange(file), detectMp4HeadMoov(file)]);
      if (!alive()) return;

      const total = file.size;
      const CHUNK_SIZE = (resumeInfo && resumeInfo.chunkSize) || (useEdgeR2 ? (4 * 1024 * 1024) : (1024 * 1024));
      const CONCURRENCY = useEdgeR2 ? 6 : 3;
      const totalChunks = Math.max(1, Math.ceil(total / CHUNK_SIZE));
      const chunkLen = (i) => Math.min(total, (i + 1) * CHUNK_SIZE) - i * CHUNK_SIZE;
      const clampIdx = (i) => Math.max(0, Math.min(totalChunks - 1, i));
      const mime = file.type || 'video/mp4';

      const hasHeadMoov = moovRange ? moovRange.start < CHUNK_SIZE : hasHeadMoovFlag;
      const indexRange = moovRange || (hasHeadMoov
        ? { start: 0, end: Math.min(total, 64 * 1024) }
        : { start: Math.max(0, total - 8 * 1024 * 1024), end: total });
      const indexChunks = [];
      for (let i = clampIdx(Math.floor(indexRange.start / CHUNK_SIZE)); i <= clampIdx(Math.floor(Math.max(0, indexRange.end - 1) / CHUNK_SIZE)); i++) {
        indexChunks.push(i);
      }

      // 先拿到影片时长，再按「开头 2 分钟」换算开映门槛（本地文件通常几十毫秒内就能读到，最多等 10 秒）
      let duration = await durationPromise;
      if (!alive()) return;
      let startBytes = computeStartBytes(total, duration);
      if (duration > 0) state.filmDuration = duration;

      const edgeStreamUrl = `${EDGE_R2_BASE}/api/edge-film?room=${encodeURIComponent(state.roomCode)}&uploadId=${encodeURIComponent(uploadId)}&partSize=${CHUNK_SIZE}&total=${total}&type=${encodeURIComponent(mime)}`;
      const ecsStreamUrl = `/api/room-film?room=${encodeURIComponent(state.roomCode)}&v=${encodeURIComponent(uploadId)}`;
      const activeStreamUrl = useEdgeR2 ? edgeStreamUrl : ecsStreamUrl;

      const record = {
        room: state.roomCode,
        uploadId,
        name: file.name,
        size: total,
        lastModified: file.lastModified || 0,
        chunkSize: CHUNK_SIZE,
        edge: useEdgeR2,
        ts: Date.now()
      };
      state.myUploadInfo = record;
      saveResumeRecord(record);

      const done = new Set();
      const retryAt = new Map();
      const failCount = new Map();

      // 续传：先问一下哪些块已经装好了
      if (resumeInfo) {
        try {
          const q = useEdgeR2
            ? `${EDGE_R2_BASE}/api/edge-parts?room=${encodeURIComponent(state.roomCode)}&uploadId=${encodeURIComponent(uploadId)}`
            : `/api/room-film?room=${encodeURIComponent(state.roomCode)}&parts=1&uploadId=${encodeURIComponent(uploadId)}`;
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          const res = await fetch(q, { cache: 'no-store', signal: ctrl.signal });
          clearTimeout(timer);
          const j = await res.json();
          if (useEdgeR2 && Array.isArray(j.parts)) {
            j.parts.forEach((idx, k) => {
              if (idx >= 0 && idx < totalChunks && (!Array.isArray(j.sizes) || Number(j.sizes[k]) === chunkLen(idx))) done.add(idx);
            });
          } else if (Array.isArray(j.offsets)) {
            j.offsets.forEach((off, k) => {
              if (off % CHUNK_SIZE !== 0) return;
              const idx = off / CHUNK_SIZE;
              if (idx < totalChunks && Number(j.sizes && j.sizes[k]) === chunkLen(idx)) done.add(idx);
            });
          }
        } catch {}
        if (!alive()) return;
        if (done.size > 0) {
          let resumedBytes = 0;
          for (const i of done) resumedBytes += chunkLen(i);
          const p = Math.min(99, Math.floor((resumedBytes / total) * 100));
          showSharePlayActionToast('↻', `这部影片之前装到了 ${p}%，接着装`, { durationMs: 3600 });
        }
      }

      // ---------- 调度 ----------
      let urgent = [0, ...indexChunks].filter((v, i, a) => a.indexOf(v) === i);
      let cursor = 0;
      let lastPriority = { idx: -1, at: 0 };
      let wakers = [];
      const wake = () => {
        const list = wakers;
        wakers = [];
        list.forEach((fn) => { try { fn(); } catch {} });
      };
      const idle = (ms) => new Promise((r) => {
        const t = setTimeout(r, ms);
        wakers.push(() => { clearTimeout(t); r(); });
      });
      const isCandidate = (i, now) => !done.has(i) && !engine.inflight.has(i) && (retryAt.get(i) || 0) <= now;
      const pick = () => {
        const now = Date.now();
        for (const i of urgent) {
          if (isCandidate(i, now)) return i;
        }
        while (cursor < totalChunks && done.has(cursor)) cursor++;
        for (let i = cursor; i < totalChunks; i++) {
          if (isCandidate(i, now)) return i;
        }
        for (let i = 0; i < Math.min(cursor, totalChunks); i++) {
          if (isCandidate(i, now)) return i;
        }
        return -1;
      };

      const prioritize = (byteOffset) => {
        if (!alive() || done.size >= totalChunks) return;
        const target = clampIdx(Math.floor((Number(byteOffset) || 0) / CHUNK_SIZE));
        const now = Date.now();
        if (lastPriority.idx === target && now - lastPriority.at < 4000) return;
        lastPriority = { idx: target, at: now };
        // 时间→字节只是线性估算（码率不均时浏览器真正要的位置常常略靠前），所以落点前 1~2 块也一起优先
        const order = [target - 1, target];
        for (let i = target + 1; i < target + 8; i++) order.push(i);
        order.push(target - 2);
        const list = order.filter((i) => i >= 0 && i < totalChunks && !done.has(i));
        urgent = [...indexChunks.filter((i) => !done.has(i)), ...list].filter((v, i, a) => a.indexOf(v) === i);
        cursor = Math.min(totalChunks, target + 8);
        for (const i of urgent) retryAt.delete(i);
        // 让出带宽：还没传过半的非紧急块先停下，稍后再补
        for (const [i, e] of engine.inflight) {
          if (urgent.includes(i)) continue;
          if ((e.loaded || 0) < chunkLen(i) * 0.5) {
            e.reason = 'preempt';
            try { e.xhr.abort(); } catch {}
          }
        }
        wake();
      };
      state.UploadPriorityEnqueue = prioritize;

      // ---------- 进度 ----------
      let sentBytes = 0;
      const speedSamples = [];
      let rangesCache = [];
      let rangesDirty = true;
      const computeRanges = () => {
        if (!rangesDirty) return rangesCache;
        const out = [];
        let runStart = -1;
        for (let i = 0; i <= totalChunks; i++) {
          if (i < totalChunks && done.has(i)) {
            if (runStart < 0) runStart = i;
          } else if (runStart >= 0) {
            out.push([runStart * CHUNK_SIZE, Math.min(total, i * CHUNK_SIZE)]);
            runStart = -1;
          }
        }
        rangesCache = out.length > 64 ? out.slice(0, 64) : out;
        rangesDirty = false;
        return rangesCache;
      };
      const doneContig = () => {
        let i = 0;
        while (i < totalChunks && done.has(i)) i++;
        return Math.min(total, i * CHUNK_SIZE);
      };
      const indexReady = () => indexChunks.every((i) => done.has(i));
      const currentSpeed = () => {
        const now = performance.now();
        speedSamples.push({ t: now, b: sentBytes });
        while (speedSamples.length > 2 && now - speedSamples[0].t > 10000) speedSamples.shift();
        const first = speedSamples[0];
        const dt = (now - first.t) / 1000;
        if (dt < 0.8) return state.filmTransfer.speedBps || 0;
        return Math.max(0, Math.round((sentBytes - first.b) / dt));
      };

      let lastAnnounceAt = 0;
      let lastRecomputeAt = 0;
      const announce = (force = false) => {
        if (!alive() || !useEdgeR2) return;
        const now = performance.now();
        if (!force && now - lastAnnounceAt < 250) return;
        lastAnnounceAt = now;
        const ft = state.filmTransfer;
        sendSignal({
          type: 'edge_transfer_progress',
          uploadId,
          name: file.name,
          mimeType: mime,
          receivedBytes: ft.receivedBytes || 0,
          contiguousBytes: ft.contiguousBytes || 0,
          totalBytes: total,
          pct: ft.pct || 0,
          speedBps: ft.speedBps || 0,
          preloadReady: Boolean(ft.preloadReady),
          streamReady: Boolean(ft.streamReady),
          ready: Boolean(ft.ready),
          ranges: computeRanges(),
          duration,
          startBytes,
          edgeStreamUrl: activeStreamUrl,
          edge: true,
          chunkSize: CHUNK_SIZE
        });
      };
      engine.announce = announce;

      const recompute = (force = false) => {
        if (!alive()) return;
        const nowMs = performance.now();
        if (!force && nowMs - lastRecomputeAt < 120) return;
        lastRecomputeAt = nowMs;
        let doneBytes = 0;
        for (const i of done) doneBytes += chunkLen(i);
        let partial = 0;
        for (const [i, e] of engine.inflight) {
          if (!done.has(i)) partial += e.loaded || 0;
        }
        const loadedSum = Math.min(total, doneBytes + partial);
        const allDone = done.size >= totalChunks;
        const contig = doneContig();
        const ft = state.filmTransfer;
        const preloadReady = Boolean(ft.preloadReady || allDone || (indexReady() && contig >= Math.min(total, 1024 * 1024)));
        const streamReady = Boolean(ft.streamReady || allDone || (indexReady() && contig >= startBytes));
        const justStream = streamReady && !ft.streamReady;
        const justPreload = preloadReady && !ft.preloadReady;
        const rawPct = allDone ? 100 : Math.min(99, Math.floor((loadedSum / total) * 100));
        ft.pct = allDone ? 100 : Math.max(ft.pct || 0, rawPct);
        ft.active = !allDone;
        ft.ready = allDone;
        ft.preloadReady = preloadReady;
        ft.streamReady = streamReady;
        ft.receivedBytes = Math.max(ft.receivedBytes || 0, loadedSum);
        ft.contiguousBytes = contig;
        ft.totalBytes = total;
        ft.speedBps = currentSpeed();
        ft.ranges = computeRanges();
        ft.duration = duration;
        ft.startBytes = startBytes;
        if (preloadReady || streamReady) {
          ft.streamUrl = activeStreamUrl;
          if (state.fileMeta && !state.fileMeta.isDemo) state.fileMeta.streamUrl = activeStreamUrl;
        }
        announce(force || justStream || justPreload);
        updateCurtainAndReadinessUI();
        refreshTimelineTrack();
      };


      const sendChunk = (idx) => new Promise((resolve) => {
        const start = idx * CHUNK_SIZE;
        const end = Math.min(total, start + CHUNK_SIZE);
        const xhr = new XMLHttpRequest();
        const entry = { xhr, loaded: 0, lastProgressAt: Date.now(), reason: null };
        engine.inflight.set(idx, entry);

        const isIndexChunk = indexChunks.includes(idx);
        const tailParam = (isIndexChunk && !hasHeadMoov) || idx === totalChunks - 1 ? '&tail=1' : '';
        const headMoovParam = hasHeadMoov ? '&headMoov=1' : '';
        const durParam = duration > 0 ? `&dur=${duration.toFixed(2)}` : '';
        const qUrl = useEdgeR2
          ? `${EDGE_R2_BASE}/api/edge-film?room=${encodeURIComponent(state.roomCode)}&uploadId=${encodeURIComponent(uploadId)}&offset=${start}&partSize=${CHUNK_SIZE}&total=${total}&type=${encodeURIComponent(mime)}`
          : `/api/room-film?room=${encodeURIComponent(state.roomCode)}&uploadId=${encodeURIComponent(uploadId)}&offset=${start}&total=${total}${tailParam}${headMoovParam}${durParam}&name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(mime)}&mode=${encodeURIComponent(state.qualityMode || '720p')}&pk=${encodeURIComponent(state.peerKey || '')}`;

        let settled = false;
        const finish = (ok, reason) => {
          if (settled) return;
          settled = true;
          engine.inflight.delete(idx);
          resolve({ ok, reason: entry.reason || reason || null });
        };

        xhr.open('PUT', qUrl, true);
        xhr.timeout = 90000;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const delta = e.loaded - (entry.loaded || 0);
          if (delta > 0) {
            sentBytes += delta;
            entry.loaded = e.loaded;
            entry.lastProgressAt = Date.now();
          }
          recompute(false);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            let superseded = false;
            try {
              const resp = JSON.parse(xhr.responseText || '{}');
              if (resp.superseded) superseded = true;
              if (resp.peerReadiness) syncPeerReadinessMap(resp.peerReadiness);
            } catch {}
            if (superseded) {
              finish(false, 'superseded');
              return;
            }
            done.add(idx);
            rangesDirty = true;
            retryAt.delete(idx);
            failCount.delete(idx);
            finish(true);
            recompute(true);
          } else {
            finish(false, `http_${xhr.status}`);
          }
        };
        xhr.onerror = () => finish(false, 'network');
        xhr.ontimeout = () => finish(false, 'timeout');
        xhr.onabort = () => finish(false, 'abort');
        try {
          xhr.send(file.slice(start, end));
        } catch {
          finish(false, 'send');
        }
      });

      // 卡死保护：30 秒没有任何上传进展的块，主动断开重发
      const stallWatch = setInterval(() => {
        if (!alive()) { clearInterval(stallWatch); return; }
        const now = Date.now();
        for (const e of engine.inflight.values()) {
          if (now - e.lastProgressAt > 30000) {
            e.reason = 'stall';
            try { e.xhr.abort(); } catch {}
          }
        }
        recompute(true);
      }, 5000);

      const workerLoop = async () => {
        while (alive() && done.size < totalChunks) {
          const idx = pick();
          if (idx === -1) {
            await idle(500);
            continue;
          }
          const r = await sendChunk(idx);
          if (!alive()) break;
          if (!r.ok) {
            if (r.reason !== 'preempt') {
              const n = (failCount.get(idx) || 0) + 1;
              failCount.set(idx, n);
              retryAt.set(idx, Date.now() + Math.min(10000, 1000 * Math.pow(2, n - 1)));
              if (n === 3 || n % 10 === 0) console.warn('[upload] chunk retry', idx, r.reason, n);
            }
            recompute(false);
          }
        }
      };
      const runWorker = async () => {
        while (alive() && done.size < totalChunks) {
          try {
            await workerLoop();
          } catch (err) {
            console.warn('[upload] worker restart', err);
            await idle(1000);
          }
        }
      };

      recompute(true);
      const workers = [];
      for (let w = 0; w < Math.min(CONCURRENCY, totalChunks); w++) workers.push(runWorker());
      await Promise.all(workers);
      clearInterval(stallWatch);

      if (alive() && done.size >= totalChunks) {
        const ft = state.filmTransfer;
        ft.active = false;
        ft.ready = true;
        ft.preloadReady = true;
        ft.streamReady = true;
        ft.pct = 100;
        ft.receivedBytes = total;
        ft.contiguousBytes = total;
        ft.totalBytes = total;
        ft.ranges = [[0, total]];
        ft.streamUrl = activeStreamUrl;
        announce(true);
        p2pProgressText.textContent = `影片已全部装好 (${formatBytes(total)})`;
        updateCurtainAndReadinessUI();
        refreshTimelineTrack();
      }
    })();
  }

  // 伴侣端挂载房间远程流式片源（绝不回退挂载默认 Demo）
  function attachRemoteRoomStream(streamUrl, fileMeta, playback) {
    if (!streamUrl || state.selectedFile || state.sameFileMatched) return;
    if (fileMeta) {
      state.fileMeta = fileMeta;
      currentFileName.textContent = fileMeta.name || '房主放映影片';
      if (curtainFilmTitle) curtainFilmTitle.textContent = fileMeta.name || '房主放映影片';
    }

    const fullUrl = streamUrl;
    if (mainMovieVideo.getAttribute('data-stream-url') === fullUrl) {
      updateCurtainAndReadinessUI();
      return;
    }

    state.localFilmReady = false;
    state.filmTransfer.preloadReady = true;
    state.filmTransfer.streamUrl = fullUrl;
    state.remoteStallSince = 0;
    state.remoteStallReloads = 0;
    state.streamResume = null;
    state.lastGoodRemoteTime = 0;

    mainMovieVideo.setAttribute('data-stream-url', fullUrl);
    mainMovieVideo.src = fullUrl;
    mainMovieVideo.load();
    p2pProgressText.textContent = `影片已同步就绪 (${formatBytes((fileMeta && fileMeta.size) || 0)})`;
    updateCurtainAndReadinessUI();

    if (playback && playback.playing) {
      applyRemotePlaybackSync({
        type: 'sync_play',
        currentTime: playback.currentTime || 0,
        playing: true,
        playbackRate: playback.playbackRate || 1
      });
    }
  }

  async function flushPendingIceCandidates() {
    if (!state.pc || !state.pc.remoteDescription || !state.pc.remoteDescription.type) return;
    while (state.pendingIceCandidates.length > 0) {
      const candidate = state.pendingIceCandidates.shift();
      try {
        await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  }

  // 4. 信令分发
  async function handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'queue_state':
      case 'queue_added':
      case 'queue_error':
      case 'queue_switch_ask':
      case 'queue_switch_pending':
      case 'queue_switch_declined':
      case 'queue_switched':
      case 'peer_versions':
        handleQueueMessage(msg);
        break;

      case 'room_joined': {
        const prevRole = state.role;
        // 重连后旧的「等 TA」状态全部作废，避免两边互相等死
        state.isPeerBuffering = false;
        state.pausedForPeerBuffering = false;
        state.peerBufferingSince = 0;
        state.peerWaitSkipOffered = false;
        state.roomCode = msg.roomCode;
        state.clientId = msg.clientId;
        state.role = msg.role;
        state.peerCount = msg.peerCount || 1;
        roomCodeBadge.textContent = `NO. ${msg.roomCode}`;

        const newUrl = `${window.location.pathname}?room=${msg.roomCode}`;
        window.history.replaceState({ roomCode: msg.roomCode }, '', newUrl);

        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }

        if (msg.sameFileMatched) {
          activateSameFileZeroTrafficMode(msg.fileMeta || state.fileMeta);
        }
        if (msg.filmTransfer && msg.filmTransfer.uploadId && !state.myUploadId) {
          state.currentUploadId = msg.filmTransfer.uploadId;
        }
        checkServerVersion();

        // 如果我选了本地文件（例如房主建房后入场），立刻启动片源流式装入，确保伴侣进房即可同步看同一部片
        if (state.selectedFile && ! (state.fileMeta && state.fileMeta.isDemo) && !state.sameFileMatched) {
          uploadHostFilmToRoom(state.selectedFile);
        } else if (!state.selectedFile) {
          // 我是伴侣（或未选片进房者）：严格以房间内的 fileMeta 为准，绝不擅自挂载默认 Demo
          if (msg.fileMeta) {
            state.fileMeta = msg.fileMeta;
            currentFileName.textContent = msg.fileMeta.name;
            if (curtainFilmTitle) curtainFilmTitle.textContent = msg.fileMeta.name;

            if (msg.fileMeta.isDemo) {
              mainMovieVideo.src = '/demo-clip.mp4';
              markLocalFilmReady(true);
            } else if (msg.filmTransfer && msg.filmTransfer.ready && msg.filmTransfer.streamUrl) {
              attachRemoteRoomStream(msg.filmTransfer.streamUrl, msg.fileMeta, msg.playback);
            } else if (msg.filmTransfer && !msg.filmTransfer.ready) {
              state.localFilmReady = false;
              state.currentUploadId = msg.filmTransfer.uploadId || state.currentUploadId;
              state.filmTransfer = {
                active: true,
                ready: false,
                preloadReady: Boolean(msg.filmTransfer.preloadReady || msg.filmTransfer.streamReady),
                streamReady: Boolean(msg.filmTransfer.streamReady),
                pct: msg.filmTransfer.pct || 0,
                receivedBytes: msg.filmTransfer.receivedBytes || 0,
                contiguousBytes: msg.filmTransfer.contiguousBytes || msg.filmTransfer.receivedBytes || 0,
                totalBytes: msg.filmTransfer.size || msg.fileMeta.size || 0,
                speedBps: msg.filmTransfer.speedBps || 0,
                streamUrl: msg.filmTransfer.streamUrl || null,
                ranges: Array.isArray(msg.filmTransfer.ranges) ? msg.filmTransfer.ranges : [],
                duration: msg.filmTransfer.duration || 0,
                startBytes: msg.filmTransfer.startBytes || 0
              };
              if ((msg.filmTransfer.preloadReady || msg.filmTransfer.streamReady) && msg.filmTransfer.streamUrl) {
                attachRemoteRoomStream(msg.filmTransfer.streamUrl, msg.fileMeta, msg.playback);
              } else {
                mainMovieVideo.removeAttribute('src');
                mainMovieVideo.removeAttribute('data-stream-url');
                mainMovieVideo.load();
              }
            } else if (msg.fileMeta.streamUrl) {
              attachRemoteRoomStream(msg.fileMeta.streamUrl, msg.fileMeta, msg.playback);
            } else {
              // 房间仅有旧文件名但无有效流也无正在进行的传输（例如服务重启后未重传）：不锁死在「正在缓冲」，直接允许选片
              mainMovieVideo.removeAttribute('src');
              mainMovieVideo.removeAttribute('data-stream-url');
              mainMovieVideo.load();
              state.localFilmReady = false;
              state.fileMeta = null;
            }
          } else if (state.role === 'host' && prevRole === 'join') {
            // 房间尚不存在且未选片直接凭码进房：等待选片，不自动塞 Demo 误导
            mainMovieVideo.removeAttribute('src');
            mainMovieVideo.load();
            state.localFilmReady = false;
          }
        }

        updateCurtainAndReadinessUI();

        if (msg.playback && msg.playback.playing && state.localFilmReady) {
          applyRemotePlaybackSync({
            type: 'sync_play',
            currentTime: msg.playback.currentTime || 0,
            playing: true,
            playbackRate: msg.playback.playbackRate || 1
          });
        }
        break;
      }

      case 'peer_joined': {
        state.peerCount = msg.peerCount || 2;
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }
        if (msg.sameFileMatched) {
          activateSameFileZeroTrafficMode(msg.fileMeta || state.fileMeta);
        }
        if (state.localFilmReady) {
          sendSignal({
            type: 'peer_film_ready',
            ready: true
          });
        }
        updateCurtainAndReadinessUI();
        await startWebRTCPeerConnection(true);
        break;
      }

      case 'peer_left': {
        state.peerCount = msg.peerCount || 1;
        closeQueueAsk();
        state.role = msg.role || state.role;
        state.peerFilmReady = false;
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }
        remoteCamVideo.srcObject = null;
        remoteCamVideo.classList.add('hidden');
        remotePortraitImg.classList.remove('hidden');
        state.remoteStream = null;
        updateCurtainAndReadinessUI();
        break;
      }

      case 'file_meta': {
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }
        const fromPeer = msg.fromId && msg.fromId !== state.clientId;
        if (fromPeer && msg.isNewSelection && !state.selectedFile) {
          state.role = 'guest';
        }
        // 续传同一部影片：片源地址不变，不打断播放、不清画面
        if (msg.resume && msg.fileMeta && !msg.fileMeta.isDemo) {
          if (!state.selectedFile || !state.myUploadId) {
            state.fileMeta = Object.assign({}, state.fileMeta || {}, msg.fileMeta);
            if (msg.filmTransfer) {
              state.filmTransfer.active = !msg.filmTransfer.ready;
              if (Array.isArray(msg.filmTransfer.ranges)) state.filmTransfer.ranges = msg.filmTransfer.ranges;
            }
          }
          updateCurtainAndReadinessUI();
          break;
        }
        // TA 选了另一部片：如果我这边正在上传，停下自己的上传，改为观看 TA 的影片
        if (fromPeer && msg.fileMeta && state.selectedFile && state.myUploadId && !msg.sameFileMatched) {
          stopMyUpload();
          state.selectedFile = null;
          state.uploadingFileRef = null;
          state.role = 'guest';
        }
        if (msg.sameFileMatched) {
          activateSameFileZeroTrafficMode(msg.fileMeta);
        } else if (msg.fileMeta) {
          const prevName = state.fileMeta && !state.fileMeta.isDemo ? state.fileMeta.name : null;
          const hadFilm = Boolean(prevName || mainMovieVideo.getAttribute('data-stream-url'));
          state.fileMeta = msg.fileMeta;
          currentFileName.textContent = msg.fileMeta.name;
          if (curtainFilmTitle) curtainFilmTitle.textContent = msg.fileMeta.name;
          if (!state.selectedFile) {
            if (msg.fileMeta.isDemo) {
              mainMovieVideo.src = '/demo-clip.mp4';
              markLocalFilmReady(true);
            } else {
              // 房主换了新本地影片，清空旧片源并展示进度条等待流就绪
              mainMovieVideo.removeAttribute('src');
              mainMovieVideo.removeAttribute('data-stream-url');
              mainMovieVideo.load();
              state.localFilmReady = false;
              state.activeSeek = null;
              state.isPeerBuffering = false;
              state.autoPausedForLoading = false;
              state.filmTransfer = {
                active: true, ready: false, preloadReady: false, streamReady: false, pct: 0,
                receivedBytes: 0, contiguousBytes: 0, totalBytes: msg.fileMeta.size || 0, speedBps: 0,
                streamUrl: null, ranges: [], duration: 0, startBytes: 0
              };
              state.currentUploadId = msg.fileMeta.uploadId || null;
              setCurtainVisible(true);
              if ((hadFilm || state.hasStartedScreening) && Date.now() - (state.queueSwitchedAt || 0) > 6000) {
                showSharePlayActionToast('🎞', 'TA 换了一部影片，正在重新为你准备画面…', { durationMs: 3600 });
              }
            }
          }
        }
        updateCurtainAndReadinessUI();
        break;
      }

      case 'film_transfer_progress': {
        if (state.sameFileMatched) break;
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }
        // 上传方自身只认本地分片进度：自己的回声直接忽略；正在上传时，别的 uploadId 的进度（旧片、旧会话残留）也一律忽略，
        // 绝不能让它改写 currentUploadId，否则自己的上传会被「劫持」停在第一批分片
        if (state.myUploadId && (!msg.uploadId || msg.uploadId === state.myUploadId)) {
          updateCurtainAndReadinessUI();
          break;
        }
        if (state.myUploadId && state.uploadEngine && msg.uploadId !== state.myUploadId) {
          break;
        }
        if (state.selectedFile && !state.myUploadId) {
          // 我在本地放片（未上传，例如两边用同一部本地片）：不受别人进度影响
          break;
        }
        const isNewUpload = msg.uploadId && state.currentUploadId !== msg.uploadId;
        if (isNewUpload) {
          state.currentUploadId = msg.uploadId;
          state.filmTransfer.pct = 0;
          state.filmTransfer.preloadReady = false;
          state.filmTransfer.streamReady = false;
          state.filmTransfer.ranges = [];
        }
        if (Array.isArray(msg.ranges)) state.filmTransfer.ranges = msg.ranges;
        if (msg.duration > 0) state.filmTransfer.duration = msg.duration;
        if (msg.startBytes > 0) state.filmTransfer.startBytes = msg.startBytes;
        state.filmTransfer.active = true;
        state.filmTransfer.ready = false;
        state.filmTransfer.pct = Math.max(state.filmTransfer.pct || 0, msg.pct || 0);
        state.filmTransfer.receivedBytes = msg.receivedBytes || 0;
        state.filmTransfer.contiguousBytes = msg.contiguousBytes || msg.receivedBytes || 0;
        state.filmTransfer.totalBytes = msg.totalBytes || (state.fileMeta && state.fileMeta.size) || 0;
        state.filmTransfer.speedBps = msg.speedBps || 0;
        if (msg.preloadReady) {
          state.filmTransfer.preloadReady = true;
          if (msg.streamUrl) state.filmTransfer.streamUrl = msg.streamUrl;
        }
        if (msg.streamReady) {
          state.filmTransfer.streamReady = true;
          state.filmTransfer.preloadReady = true;
          if (msg.streamUrl) state.filmTransfer.streamUrl = msg.streamUrl;
        }
        if (msg.name && (!state.fileMeta || state.fileMeta.name !== msg.name)) {
          state.fileMeta = {
            name: msg.name,
            size: msg.totalBytes || 0,
            isDemo: false,
            streamUrl: msg.streamUrl || (state.fileMeta && state.fileMeta.streamUrl) || null
          };
          currentFileName.textContent = msg.name;
        }
        // 核心修复：一旦首块 1MB + moov 就绪（preloadReady = true），伴侣端提前挂载流预解码首帧，开头约 2 分钟装好即可先开映
        if (!state.selectedFile && (msg.preloadReady || msg.streamReady) && msg.streamUrl) {
          attachRemoteRoomStream(msg.streamUrl, state.fileMeta, null);
        } else if (!state.selectedFile && !state.hasStartedScreening) {
          setCurtainVisible(true);
        }
        updateCurtainAndReadinessUI();
        refreshTimelineTrack();
        break;
      }

      case 'priority_chunk_needed': {
        if (msg.uploadId && state.myUploadId && msg.uploadId !== state.myUploadId) break;
        if (typeof state.UploadPriorityEnqueue === 'function' && typeof msg.offset === 'number') {
          state.UploadPriorityEnqueue(msg.offset);
        }
        break;
      }

      case 'seek_all_aligned': {
        if (state.activeSeek && msg.seekId && state.activeSeek.seekId !== msg.seekId) break;
        if (!state.activeSeek && msg.seekId && msg.seekId === state.abandonedSeekId) break;
        state.activeSeek = null;
        state.isPeerBuffering = false;
        const targetTime = typeof msg.currentTime === 'number' ? msg.currentTime : (mainMovieVideo.currentTime || 0);
        state.suppressSyncEmit = true;
        if (Math.abs((mainMovieVideo.currentTime || 0) - targetTime) > 0.35 && mainMovieVideo.readyState >= 1) {
          try { mainMovieVideo.currentTime = targetTime; } catch {}
        }
        clearPersistentActionToast();
        if (msg.playing !== false) {
          hideScreenPauseOverlay();
          setCurtainVisible(false);
          safePlayMovieVideo();
          updatePlayButtonUI(true);
          showSharePlayActionToast('✨', `画面已对齐至 ${formatCinemaTime(targetTime)} · 继续放映`, { durationMs: 2200 });
        } else {
          showScreenPauseOverlay('已暂停放映', formatCinemaTime(targetTime));
          showSharePlayActionToast('✨', `画面已对齐至 ${formatCinemaTime(targetTime)}`, { durationMs: 2000 });
        }
        setTimeout(() => { state.suppressSyncEmit = false; }, 100);
        updateLiveSyncUI();
        break;
      }

      case 'film_transfer_ready': {
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }
        if (state.myUploadId && state.uploadEngine && msg.uploadId && msg.uploadId !== state.myUploadId) break;
        if (state.myUploadId && msg.uploadId === state.myUploadId && !state.filmTransfer.ready) {
          // 服务端确认的就是我这一份：以服务端为准
        }
        state.filmTransfer.ranges = [[0, state.filmTransfer.totalBytes || (msg.fileMeta && msg.fileMeta.size) || 0]];
        state.filmTransfer.active = false;
        state.filmTransfer.ready = true;
        state.filmTransfer.pct = 100;
        state.filmTransfer.streamUrl = msg.streamUrl || null;
        if (msg.fileMeta) {
          state.fileMeta = msg.fileMeta;
          currentFileName.textContent = msg.fileMeta.name;
        }
        if (!state.selectedFile && !state.sameFileMatched && msg.streamUrl) {
          attachRemoteRoomStream(msg.streamUrl, msg.fileMeta || state.fileMeta, null);
        } else {
          updateCurtainAndReadinessUI();
        }
        refreshTimelineTrack();
        break;
      }

      case 'peer_film_ready': {
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        } else if (msg.fromId && msg.fromId !== state.clientId) {
          state.peerFilmReady = Boolean(msg.ready);
        }
        updateCurtainAndReadinessUI();
        break;
      }

      case 'same_file_matched': {
        if (msg.peerReadiness) {
          syncPeerReadinessMap(msg.peerReadiness);
        }
        activateSameFileZeroTrafficMode(msg.fileMeta);
        break;
      }

      case 'webrtc_offer': {
        if (!state.pc || state.pc.connectionState === 'closed') {
          await startWebRTCPeerConnection(false);
        }
        if (!state.pc) return;

        try {
          const offerCollision = state.makingOffer || state.pc.signalingState !== 'stable';
          if (offerCollision) {
            if (state.role === 'host') {
              return;
            }
            await state.pc.setLocalDescription({ type: 'rollback' });
          }

          await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          attachLocalTracksToPeerConnection(state.pc);
          await flushPendingIceCandidates();

          const answer = await state.pc.createAnswer();
          answer.sdp = enhanceOpusSdp(answer.sdp);
          await state.pc.setLocalDescription(answer);
          state.hasCompletedInitialHandshake = true;

          sendSignal({
            type: 'webrtc_answer',
            sdp: state.pc.localDescription
          });

          if (state.localStream && attachLocalTracksToPeerConnection(state.pc)) {
            await renegotiatePeerConnection();
          }
        } catch (err) {
          console.warn('webrtc_offer error:', err);
        }
        break;
      }

      case 'webrtc_answer': {
        if (state.pc && state.pc.signalingState === 'have-local-offer') {
          try {
            await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            state.hasCompletedInitialHandshake = true;
            await flushPendingIceCandidates();

            if (state.localStream && attachLocalTracksToPeerConnection(state.pc)) {
              await renegotiatePeerConnection();
            }
          } catch (err) {
            console.warn('webrtc_answer error:', err);
          }
        }
        break;
      }

      case 'webrtc_ice': {
        if (!msg.candidate) break;
        if (state.pc && state.pc.remoteDescription && state.pc.remoteDescription.type) {
          try {
            await state.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {}
        } else {
          state.pendingIceCandidates.push(msg.candidate);
        }
        break;
      }

      case 'sync_play':
      case 'sync_pause':
      case 'sync_seek':
      case 'sync_rate':
      case 'sync_heartbeat': {
        applyRemotePlaybackSync(msg);
        break;
      }

      case 'transfer_status': {
        if (msg.action === 'start_zero_wait_sync') {
          state.instantSyncOverride = true;
          state.peerFilmReady = true;
          state.peerPlayback.playing = true;
          state.peerPlayback.currentTime = typeof msg.currentTime === 'number' ? msg.currentTime : 0;
          state.peerPlayback.updatedAt = Date.now();
          if (msg.fileMeta) {
            state.fileMeta = msg.fileMeta;
            currentFileName.textContent = msg.fileMeta.name;
            if (curtainFilmTitle) curtainFilmTitle.textContent = msg.fileMeta.name;
          }
          const liveUrl = msg.streamUrl || state.filmTransfer.streamUrl || (state.roomCode ? `/api/room-film?room=${encodeURIComponent(state.roomCode)}` : null);
          if (!state.selectedFile && liveUrl && !mainMovieVideo.getAttribute('data-stream-url')) {
            attachRemoteRoomStream(liveUrl, msg.fileMeta || state.fileMeta, {
              playing: true,
              currentTime: typeof msg.currentTime === 'number' ? msg.currentTime : 0,
              playbackRate: 1
            });
          }
          setCurtainVisible(false);
          updateCurtainAndReadinessUI();
          if (typeof msg.currentTime === 'number' && Math.abs((mainMovieVideo.currentTime || 0) - msg.currentTime) > 1.0 && mainMovieVideo.readyState >= 1) {
            try { mainMovieVideo.currentTime = msg.currentTime; } catch {}
          }
          safePlayMovieVideo();
          updatePlayButtonUI(true);
          showSharePlayActionToast('🎬', '两边一起在播', { durationMs: 2600 });
        }
        break;
      }

      case 'peer_speaking': {
        if (msg.speaking) {
          state.lastVoiceTimestamp = Date.now();
          setDuckingActive(true, 'remote');
        }
        break;
      }

      case 'peer_buffering': {
        if (msg.buffering) {
          if (!state.isPeerBuffering) {
            state.peerBufferingSince = Date.now();
            state.peerWaitSkipOffered = false;
          }
          state.isPeerBuffering = true;
          if (!mainMovieVideo.paused) {
            state.pausedForPeerBuffering = true;
            state.suppressSyncEmit = true;
            mainMovieVideo.pause();
            updatePlayButtonUI(false);
            setTimeout(() => { state.suppressSyncEmit = false; }, 80);
          }
          const tStr = formatCinemaTime(typeof msg.currentTime === 'number' ? msg.currentTime : mainMovieVideo.currentTime);
          showSharePlayActionToast('⏳', `TA 那边网络稍慢（${tStr}），已自动停下等 TA…`, { persistent: true });
        } else {
          const wasWaiting = state.isPeerBuffering || state.pausedForPeerBuffering;
          state.isPeerBuffering = false;
          state.peerBufferingSince = 0;
          if (wasWaiting) {
            clearPersistentActionToast();
            showSharePlayActionToast('▶', 'TA 好了 · 继续', { durationMs: 2200 });
          }
          if (state.pausedForPeerBuffering || msg.playing) {
            state.pausedForPeerBuffering = false;
            state.suppressSyncEmit = true;
            if (typeof msg.currentTime === 'number' && Math.abs(mainMovieVideo.currentTime - msg.currentTime) > 2.5 && mainMovieVideo.readyState >= 3) {
              mainMovieVideo.currentTime = msg.currentTime;
            }
            safePlayMovieVideo();
            updatePlayButtonUI(true);
            setTimeout(() => { state.suppressSyncEmit = false; }, 80);
          }
        }
        updateLiveSyncUI();
        break;
      }

      case 'room_full':
      case 'error': {
        alert(msg.message || '包厢请求未成功');
        break;
      }
    }
  }

  function activateSameFileZeroTrafficMode(meta) {
    state.sameFileMatched = true;
    state.filmTransfer.active = false;
    state.filmTransfer.ready = true;
    state.filmTransfer.pct = 100;
    stopMyUpload();
    state.localFilmReady = true;
    state.peerFilmReady = true;
    p2pProgressText.textContent = `已匹配同一部本地影片 (${formatBytes(meta?.size || 0)})`;
    updateCurtainAndReadinessUI();
  }

  function tuneWebRTCSenderParameters(pc) {
    if (!pc || !pc.getSenders) return;
    for (const sender of pc.getSenders()) {
      if (!sender.track || !sender.getParameters || !sender.setParameters) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        if (sender.track.kind === 'video') {
          params.degradationPreference = 'maintain-framerate';
          params.encodings[0].maxBitrate = 320000;
          params.encodings[0].maxFramerate = 30;
        } else if (sender.track.kind === 'audio') {
          params.encodings[0].maxBitrate = 64000;
          params.encodings[0].priority = 'high';
          params.encodings[0].networkPriority = 'high';
        }
        sender.setParameters(params).catch(() => {});
      } catch {}
    }
  }

  function enhanceOpusSdp(sdp) {
    if (!sdp || typeof sdp !== 'string') return sdp;
    return sdp.replace(/a=fmtp:(\d+) minptime=10;useinbandfec=1/g, 'a=fmtp:$1 minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=64000;usedtx=0;cbr=1');
  }

  function attachLocalTracksToPeerConnection(pc) {
    if (!pc || !state.localStream) return false;
    let addedNewTrack = false;
    const senders = pc.getSenders ? pc.getSenders() : [];

    for (const track of state.localStream.getTracks()) {
      if (track.kind === 'video' && 'contentHint' in track) {
        track.contentHint = 'motion';
      }
      const existingExact = senders.find((s) => s.track && s.track.id === track.id);
      if (existingExact) continue;

      const sameKindSender = senders.find((s) => s.track && s.track.kind === track.kind);
      if (sameKindSender) {
        sameKindSender.replaceTrack(track).catch(() => {});
      } else {
        pc.addTrack(track, state.localStream);
        addedNewTrack = true;
      }
    }
    tuneWebRTCSenderParameters(pc);
    return addedNewTrack;
  }

  async function renegotiatePeerConnection() {
    if (!state.pc || state.makingOffer || state.pc.signalingState !== 'stable') return;
    try {
      state.makingOffer = true;
      const offer = await state.pc.createOffer();
      if (state.pc.signalingState !== 'stable') return;
      offer.sdp = enhanceOpusSdp(offer.sdp);
      await state.pc.setLocalDescription(offer);
      sendSignal({
        type: 'webrtc_offer',
        sdp: state.pc.localDescription
      });
    } catch (err) {
      console.warn('renegotiate error:', err);
    } finally {
      state.makingOffer = false;
    }
  }

  // 5. WebRTC 双人视频连麦（仅传双方真人摄像头与麦克风，绝不混入电影轨道）
  async function startWebRTCPeerConnection(isInitiator) {
    if (state.pc) {
      try { state.pc.close(); } catch {}
      state.pendingIceCandidates = [];
    }
    state.hasCompletedInitialHandshake = false;
    state.remoteStream = null;

    if (!state.localStream && state.localCameraPromise) {
      await Promise.race([
        state.localCameraPromise,
        new Promise((r) => setTimeout(r, 600))
      ]);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.miwifi.com:3478' },
        { urls: 'stun:stun.qq.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });
    state.pc = pc;

    attachLocalTracksToPeerConnection(pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({
          type: 'webrtc_ice',
          candidate: e.candidate
        });
      }
    };

    pc.ontrack = (e) => {
      if (!state.remoteStream) {
        state.remoteStream = new MediaStream();
      }
      if (e.streams && e.streams[0]) {
        e.streams[0].getTracks().forEach((t) => {
          if (!state.remoteStream.getTracks().some((existing) => existing.id === t.id)) {
            state.remoteStream.addTrack(t);
          }
        });
      } else if (e.track) {
        if (!state.remoteStream.getTracks().some((existing) => existing.id === e.track.id)) {
          state.remoteStream.addTrack(e.track);
        }
      }

      if (remoteCamVideo.srcObject !== state.remoteStream) {
        remoteCamVideo.srcObject = state.remoteStream;
      }

      if (state.remoteStream.getVideoTracks().length > 0) {
        remoteCamVideo.classList.remove('hidden');
        remotePortraitImg.classList.add('hidden');
      }

      remoteCamVideo.play().catch(() => {
        remoteCamVideo.muted = true;
        remoteCamVideo.play().catch(() => {});
        const unmuteOnTap = () => {
          remoteCamVideo.muted = Boolean(state.peerMuted);
          window.removeEventListener('pointerdown', unmuteOnTap);
        };
        window.addEventListener('pointerdown', unmuteOnTap, { once: true });
      });

      if (state.remoteStream.getAudioTracks().length > 0) {
        setupAudioAnalyserForStream(state.remoteStream, 'remote');
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('loamly-file-p2p', { ordered: true });
      setupFileDataChannel(dc, true);
      await renegotiatePeerConnection();
    } else {
      pc.ondatachannel = (e) => {
        if (e.channel.label === 'loamly-file-p2p') {
          setupFileDataChannel(e.channel, false);
        }
      };
    }
  }

  function setupFileDataChannel(dc) {
    state.fileChannel = dc;
    dc.binaryType = 'arraybuffer';
  }

  function checkAndReportLocalSeekReady() {
    if (!state.activeSeek || state.activeSeek.reportedReady) return;
    if (!mainMovieVideo.seeking && mainMovieVideo.readyState >= 2) {
      state.activeSeek.reportedReady = true;
      sendSignal({
        type: 'seek_ready',
        seekId: state.activeSeek.seekId,
        currentTime: state.activeSeek.targetTime,
        sentAt: Date.now()
      });
    }
  }

  // 让上传方把 timeSec 附近的影片片段排到最前面（上传方是我自己时直接调本地调度器）
  function requestFilmPriorityAt(timeSec, reason) {
    if (state.sameFileMatched) return;
    const ft = state.filmTransfer || {};
    if (ft.ready) return;
    const dur = mainMovieVideo.duration || ft.duration || state.filmDuration || 0;
    const total = ft.totalBytes || (state.fileMeta && state.fileMeta.size) || 0;
    if (!(dur > 0) || !(total > 0)) return;
    const offset = Math.max(0, Math.min(total - 1, Math.floor((Math.max(0, timeSec) / dur) * total)));
    if (state.myUploadId && typeof state.UploadPriorityEnqueue === 'function') {
      state.UploadPriorityEnqueue(offset);
      return;
    }
    if (!ft.active) return;
    state.lastPriorityRequestAt = Date.now();
    sendSignal({ type: 'request_priority_chunk', offset, reason: reason || 'seek' });
  }

  // 6. 播放同步与校准（防缓冲断流死锁 + SharePlay 顶部灵动胶囊提示 + 软倍速追帧）
  function applyRemotePlaybackSync(msg) {
    state.suppressSyncEmit = true;
    try {
      if (typeof msg.playbackRate === 'number' && msg.playbackRate > 0) {
        state.basePlaybackRate = msg.playbackRate;
        playbackRateSelect.value = String(msg.playbackRate);
        if (msg.type === 'sync_rate') {
          mainMovieVideo.playbackRate = msg.playbackRate;
          showSharePlayActionToast('⚡', `TA 将放映倍速调为 ${msg.playbackRate}x`, { durationMs: 2400 });
        }
      }

      const netDelaySec = msg.sentAt ? Math.max(0, Math.min(0.35, (Date.now() - msg.sentAt) / 1000)) : 0;
      const expectedTime = typeof msg.currentTime === 'number'
        ? (msg.playing ? msg.currentTime + netDelaySec : msg.currentTime)
        : (mainMovieVideo.currentTime || 0);

      state.peerPlayback = {
        currentTime: expectedTime,
        playing: Boolean(msg.playing),
        playbackRate: state.basePlaybackRate || 1.0,
        updatedAt: Date.now()
      };

      const myTime = mainMovieVideo.currentTime || 0;
      const drift = Math.abs(myTime - expectedTime);
      const isVideoBusyBuffering = state.isLocalBuffering || mainMovieVideo.seeking || mainMovieVideo.readyState < 3;

      if (msg.type === 'sync_seek') {
        const targetTime = typeof msg.currentTime === 'number' ? msg.currentTime : expectedTime;
        const seekId = msg.seekId || `${Date.now()}`;
        const shouldPlayAfterAlign = msg.shouldPlayAfterAlign !== false;
        state.activeSeek = {
          seekId,
          targetTime,
          shouldPlayAfterAlign,
          reportedReady: false
        };
        mainMovieVideo.playbackRate = state.basePlaybackRate || 1.0;
        if (!mainMovieVideo.paused) {
          mainMovieVideo.pause();
        }
        updatePlayButtonUI(false);
        try {
          mainMovieVideo.currentTime = targetTime;
        } catch {}
        state.lastHardSyncAt = Date.now();
        state.autoPausedForLoading = false;
        const dur = mainMovieVideo.duration || 0;
        requestFilmPriorityAt(targetTime, 'peer_seek');
        if (dur > 0 && !state.isDraggingTimeline) {
          const pct = (targetTime / dur) * 100;
          timelineSlider.value = String(pct.toFixed(1));
          updateSliderProgressTrack(pct);
          timeReadout.textContent = `${formatCinemaTime(targetTime)} / ${formatCinemaTime(dur)}`;
        }
        showScreenPauseOverlay('TA 调整了放映进度', `正在跳至 ${formatCinemaTime(targetTime)} · 画面对齐后自动继续`);
        showSharePlayActionToast('⏳', `TA 调整了进度至 ${formatCinemaTime(targetTime)} · 正在对齐画面…`, { persistent: true });
        if (timelineSlider) {
          timelineSlider.classList.add('pulse-gold');
          setTimeout(() => timelineSlider.classList.remove('pulse-gold'), 1200);
        }
        checkAndReportLocalSeekReady();
      } else if (msg.type === 'sync_pause') {
        state.isPeerBuffering = false;
        mainMovieVideo.playbackRate = state.basePlaybackRate || 1.0;
        if (!isVideoBusyBuffering && drift > 0.5) {
          mainMovieVideo.currentTime = expectedTime;
        }
        if (!mainMovieVideo.paused) {
          mainMovieVideo.pause();
        }
        updatePlayButtonUI(false);
        if (msg.reason === 'loading') {
          // 上传方那边还没装到这里：两边一起停下，装好后上传方会自动一起继续
          state.peerLoadingPause = true;
          const text = loadingWaitText(Number(msg.etaSec) || 0);
          showScreenPauseOverlay('影片还在装入', text);
          showSharePlayActionToast('⏳', text, { persistent: true });
        } else {
          state.peerLoadingPause = false;
          showScreenPauseOverlay('TA 暂停了放映', formatCinemaTime(expectedTime));
          showSharePlayActionToast('⏸', `TA 暂停了放映 · ${formatCinemaTime(expectedTime)}`, { persistent: true });
        }
      } else if (msg.type === 'sync_play') {
        // TA 明确继续放映：之前任何「对齐中 / 等 TA / 等装入」的状态都结束
        const wasLoadingPause = state.peerLoadingPause;
        state.isPeerBuffering = false;
        state.peerBufferingSince = 0;
        state.pausedForPeerBuffering = false;
        state.peerLoadingPause = false;
        state.activeSeek = null;
        if (state.autoPausedForLoading) {
          state.autoPausedForLoading = false;
          state.loadingPauseSuppressUntil = Date.now() + 20000;
        }
        hideScreenPauseOverlay();
        clearPersistentActionToast();
        showSharePlayActionToast('▶', wasLoadingPause ? `影片装好了 · 一起继续 ${formatCinemaTime(expectedTime)}` : `TA 继续了放映 · ${formatCinemaTime(expectedTime)}`, { durationMs: 2200 });
        if (state.localFilmReady) {
          setCurtainVisible(false);
          if (!isVideoBusyBuffering && drift > 1.5) {
            mainMovieVideo.currentTime = expectedTime;
            state.lastHardSyncAt = Date.now();
          }
          if (mainMovieVideo.paused) {
            safePlayMovieVideo();
          }
          updatePlayButtonUI(true);
        }
      } else if (msg.type === 'sync_heartbeat') {
        if (msg.buffering === false && state.isPeerBuffering) {
          // 心跳说 TA 已经不卡了（可能 peer_buffering:false 丢了）：解除等待
          state.isPeerBuffering = false;
          state.peerBufferingSince = 0;
          if (state.pausedForPeerBuffering) {
            state.pausedForPeerBuffering = false;
            clearPersistentActionToast();
            if (msg.playing && state.localFilmReady) {
              safePlayMovieVideo();
              updatePlayButtonUI(true);
            }
          }
        }
        if (msg.buffering === true) return;
        if (state.activeSeek || state.isDraggingTimeline) return;
        if (state.autoPausedForLoading || state.peerLoadingPause) return;
        // 核心防卡顿：播放期间保持原速 1.0x，绝不频繁改动 playbackRate 或 currentTime 导致解码器与 HTTP 流抖动
        if (!isVideoBusyBuffering && !state.isPeerBuffering) {
          const baseRate = state.basePlaybackRate || 1.0;
          if (Math.abs(mainMovieVideo.playbackRate - baseRate) > 0.005) {
            mainMovieVideo.playbackRate = baseRate;
          }
          if (msg.playing && !mainMovieVideo.paused) {
            if (drift > 3.2 && Date.now() - state.lastHardSyncAt > 8000 && mainMovieVideo.readyState >= 3) {
              mainMovieVideo.currentTime = expectedTime;
              state.lastHardSyncAt = Date.now();
            }
          }

          if (msg.playing && mainMovieVideo.paused && state.localFilmReady && state.hasStartedScreening) {
            hideScreenPauseOverlay();
            setCurtainVisible(false);
            safePlayMovieVideo();
            updatePlayButtonUI(true);
          } else if (msg.playing === false && !mainMovieVideo.paused) {
            mainMovieVideo.pause();
            updatePlayButtonUI(false);
            showScreenPauseOverlay('TA 暂停了放映', formatCinemaTime(expectedTime));
          }
        }
      }

      updateLiveSyncUI();
    } finally {
      setTimeout(() => {
        state.suppressSyncEmit = false;
      }, 80);
    }
  }

  function showScreenPauseOverlay(titleText, subText) {
    if (theaterStage) {
      theaterStage.classList.add('is-paused-dimmed');
    }
    if (screenPauseOverlay) {
      if (pauseOverlayTitle && titleText) pauseOverlayTitle.textContent = titleText;
      if (pauseOverlaySub && subText) pauseOverlaySub.textContent = subText;
      screenPauseOverlay.classList.remove('hidden');
    }
  }

  function hideScreenPauseOverlay() {
    if (theaterStage) {
      theaterStage.classList.remove('is-paused-dimmed');
    }
    if (screenPauseOverlay) {
      screenPauseOverlay.classList.add('hidden');
    }
  }

  // ---------- 声音：影片声音 / TA 的声音（各自可静音，记在本机） ----------
  const SPEAKER_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"></path><path d="M15.2 9.2a4 4 0 0 1 0 5.6"></path><path d="M17.8 6.7a7.5 7.5 0 0 1 0 10.6"></path></svg>';
  const SPEAKER_MUTED_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"></path><path d="M15.2 9.2a4 4 0 0 1 0 5.6"></path><line x1="3.5" y1="3.5" x2="20.5" y2="20.5"></line></svg>';
  const MIXER_ICON_DEFAULT = (volumeMixerBtn && volumeMixerBtn.querySelector('svg')) ? volumeMixerBtn.querySelector('svg').outerHTML : '';
  const MIXER_PREFS_KEY = 'loamly_mixer_v1';

  function saveMixerPrefs() {
    try {
      localStorage.setItem(MIXER_PREFS_KEY, JSON.stringify({
        movie: state.movieVolPct,
        peer: state.peerVolPct,
        movieMuted: state.movieMuted,
        peerMuted: state.peerMuted,
        preMovie: state.preMuteMovieVolPct,
        prePeer: state.preMutePeerVolPct
      }));
    } catch {}
  }

  function loadMixerPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(MIXER_PREFS_KEY) || 'null');
      if (!p) return;
      if (typeof p.movie === 'number') state.movieVolPct = Math.max(0, Math.min(100, p.movie));
      if (typeof p.peer === 'number') state.peerVolPct = Math.max(0, Math.min(200, p.peer));
      state.movieMuted = Boolean(p.movieMuted) || state.movieVolPct === 0;
      state.peerMuted = Boolean(p.peerMuted) || state.peerVolPct === 0;
      if (p.preMovie > 0) state.preMuteMovieVolPct = p.preMovie;
      if (p.prePeer > 0) state.preMutePeerVolPct = p.prePeer;
    } catch {}
  }

  function renderMixerUI() {
    const mPct = Math.round(state.movieVolPct);
    const pPct = Math.round(state.peerVolPct);
    if (movieVolVal) movieVolVal.textContent = state.movieMuted ? '已静音' : `${mPct}%`;
    if (peerVolVal) peerVolVal.textContent = state.peerMuted ? '已静音' : `${pPct}%`;
    if (movieVolumeSlider) {
      if (Number(movieVolumeSlider.value) !== mPct) movieVolumeSlider.value = String(mPct);
      movieVolumeSlider.classList.toggle('is-muted', state.movieMuted);
      updateMixerSliderFill(movieVolumeSlider);
    }
    if (peerVolumeSlider) {
      if (Number(peerVolumeSlider.value) !== pPct) peerVolumeSlider.value = String(pPct);
      peerVolumeSlider.classList.toggle('is-muted', state.peerMuted);
      updateMixerSliderFill(peerVolumeSlider);
    }
    if (movieMuteBtn) {
      movieMuteBtn.innerHTML = state.movieMuted ? SPEAKER_MUTED_ICON : SPEAKER_ICON;
      movieMuteBtn.classList.toggle('is-muted', state.movieMuted);
      movieMuteBtn.setAttribute('aria-pressed', state.movieMuted ? 'true' : 'false');
      const t = state.movieMuted ? '打开影片声音（M）' : '静音影片声音（M）';
      movieMuteBtn.setAttribute('aria-label', t);
      movieMuteBtn.title = t;
    }
    if (peerMuteBtn) {
      peerMuteBtn.innerHTML = state.peerMuted ? SPEAKER_MUTED_ICON : SPEAKER_ICON;
      peerMuteBtn.classList.toggle('is-muted', state.peerMuted);
      peerMuteBtn.setAttribute('aria-pressed', state.peerMuted ? 'true' : 'false');
      const t = state.peerMuted ? '打开 TA 的声音（N）' : '静音 TA 的声音（N）';
      peerMuteBtn.setAttribute('aria-label', t);
      peerMuteBtn.title = t;
    }
    if (peerMuteHint) { peerMuteHint.classList.add('hidden'); peerMuteHint.hidden = true; }
    if (volumeMixerBtn) {
      const both = state.movieMuted && state.peerMuted;
      const one = !both && (state.movieMuted || state.peerMuted);
      const wantIcon = both ? SPEAKER_MUTED_ICON : MIXER_ICON_DEFAULT;
      if (volumeMixerBtn.dataset.iconState !== (both ? 'muted' : 'normal')) {
        volumeMixerBtn.dataset.iconState = both ? 'muted' : 'normal';
        volumeMixerBtn.innerHTML = wantIcon;
        if (volumeMixerDot) volumeMixerBtn.appendChild(volumeMixerDot);
      }
      if (volumeMixerDot) volumeMixerDot.classList.toggle('hidden', !one);
      volumeMixerBtn.classList.toggle('is-all-muted', both);
      const label = both ? '影片声音和 TA 的声音都已静音' : (state.movieMuted ? '影片声音已静音' : (state.peerMuted ? 'TA 的声音已静音' : '调节影片声音与 TA 的声音'));
      volumeMixerBtn.title = label;
      volumeMixerBtn.setAttribute('aria-label', label);
    }
    if (movieVolumeText) movieVolumeText.textContent = state.movieMuted ? '已静音' : `${mPct}%`;
  }

  function updateMixerSliderFill(slider) {
    if (!slider) return;
    const max = Number(slider.max) || 100;
    const pct = Math.max(0, Math.min(100, (Number(slider.value) / max) * 100));
    slider.style.setProperty('--mixer-pct', `${pct}%`);
  }

  function applyMovieAudio() {
    const vol = state.movieVolPct / 100;
    state.userMovieVolume = state.movieMuted ? 0 : vol;
    state.targetVolume = (state.duckingEnabled && state.isSpeaking) ? Math.min(state.userMovieVolume, DUCK_TARGET_VOLUME) : state.userMovieVolume;
    state.currentVolume = state.targetVolume;
    mainMovieVideo.volume = Math.max(0, Math.min(1, state.currentVolume));
    mainMovieVideo.muted = state.movieMuted;
  }

  function applyPeerAudio() {
    const ratio = state.peerVolPct / 100;
    state.userPeerVolume = state.peerMuted ? 0 : ratio;
    if (remoteCamVideo) {
      remoteCamVideo.muted = state.peerMuted;
      remoteCamVideo.volume = Math.max(0, Math.min(1, ratio));
    }
    if (state.remoteGainNode && state.audioCtx) {
      // 增益节点只负责 100% 以上的「额外放大」部分；静音时归零
      const extra = state.peerMuted ? 0 : Math.max(0, ratio - 1);
      try { state.remoteGainNode.gain.setValueAtTime(extra, state.audioCtx.currentTime); } catch {}
    }
  }

  // 拖动滑杆：拖到 0 视为静音；从静音状态拖动则自动取消静音
  function applyUserMovieVolume(pctValue, fromUser = true) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(pctValue) || 0)));
    state.movieVolPct = pct;
    if (pct === 0) {
      state.movieMuted = true;
    } else {
      state.preMuteMovieVolPct = pct;
      if (fromUser) state.movieMuted = false;
    }
    applyMovieAudio();
    renderMixerUI();
    saveMixerPrefs();
  }

  function applyUserPeerVolume(pctValue, fromUser = true) {
    const pct = Math.max(0, Math.min(200, Math.round(Number(pctValue) || 0)));
    state.peerVolPct = pct;
    if (pct === 0) {
      state.peerMuted = true;
    } else {
      state.preMutePeerVolPct = pct;
      if (fromUser) state.peerMuted = false;
    }
    applyPeerAudio();
    renderMixerUI();
    saveMixerPrefs();
  }

  function toggleMovieMute() {
    if (state.movieMuted) {
      state.movieMuted = false;
      if (state.movieVolPct === 0) state.movieVolPct = state.preMuteMovieVolPct > 0 ? state.preMuteMovieVolPct : 100;
    } else {
      if (state.movieVolPct > 0) state.preMuteMovieVolPct = state.movieVolPct;
      state.movieMuted = true;
    }
    applyMovieAudio();
    renderMixerUI();
    saveMixerPrefs();
  }

  function togglePeerMute() {
    if (state.peerMuted) {
      state.peerMuted = false;
      if (state.peerVolPct === 0) state.peerVolPct = state.preMutePeerVolPct > 0 ? state.preMutePeerVolPct : 100;
    } else {
      if (state.peerVolPct > 0) state.preMutePeerVolPct = state.peerVolPct;
      state.peerMuted = true;
    }
    applyPeerAudio();
    renderMixerUI();
    saveMixerPrefs();
  }

  // 悬停在还没装入的那段进度条上：提示「拖过去会稍等一会儿」（不限制拖动）
  function initTimelineHover() {
    const wrap = timelineSlider && timelineSlider.closest('.dock-slider-wrap');
    if (!wrap || !timelineHoverTip) return;
    const hide = () => timelineHoverTip.classList.add('hidden');
    wrap.addEventListener('mousemove', (e) => {
      const rect = timelineSlider.getBoundingClientRect();
      if (rect.width <= 0) return hide();
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const { loading } = getLoadedRangesPct();
      if (!loading || isTimelinePctLoaded(pct)) return hide();
      const wrapRect = wrap.getBoundingClientRect();
      timelineHoverTip.style.left = `${e.clientX - wrapRect.left}px`;
      timelineHoverTip.classList.remove('hidden');
    });
    wrap.addEventListener('mouseleave', hide);
    timelineSlider.addEventListener('mousedown', hide);
  }

  function initMixer() {
    loadMixerPrefs();
    applyMovieAudio();
    applyPeerAudio();
    renderMixerUI();
    if (movieMuteBtn) movieMuteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMovieMute(); });
    if (peerMuteBtn) peerMuteBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePeerMute(); });
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'm') {
        toggleMovieMute();
        showSharePlayActionToast(state.movieMuted ? '🔇' : '🔊', state.movieMuted ? '影片声音已静音' : '影片声音已打开', { durationMs: 1400 });
      } else if (k === 'n') {
        togglePeerMute();
        showSharePlayActionToast(state.peerMuted ? '🔇' : '🔊', state.peerMuted ? 'TA 的声音已静音' : 'TA 的声音已打开', { durationMs: 2000 });
      }
    });
  }

  function updatePlayButtonUI(isPlaying) {
    if (isPlaying) {
      playPauseSvg.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
    } else {
      playPauseSvg.innerHTML = '<polygon points="7 5 19 12 7 19 7 5"></polygon>';
    }
  }

  function triggerStartOrTogglePlayback() {
    if (!state.fileMeta || !state.fileMeta.name) {
      localVideoFileInput.click();
      return;
    }
    if (!isScreeningReadyToStart()) {
      updateCurtainAndReadinessUI();
      return;
    }
    ensureAudioContext();
    setCurtainVisible(false);
    if (mainMovieVideo.paused) {
      safePlayMovieVideo();
    } else {
      mainMovieVideo.pause();
    }
  }

  function bindMovieVideoEvents() {
    const onFilmCanPlay = () => {
      const cur = mainMovieVideo.currentTime || 0;
      const dur = mainMovieVideo.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      timelineSlider.value = String(pct.toFixed(1));
      updateSliderProgressTrack(pct);
      timeReadout.textContent = `${formatCinemaTime(cur)} / ${formatCinemaTime(dur)}`;
      if (mainMovieVideo.currentSrc || mainMovieVideo.src) {
        state.streamErrorRetryCount = 0;
        if (!state.localFilmReady) {
          markLocalFilmReady(true);
        }
        if (
          !state.activeSeek &&
          !state.isDraggingTimeline &&
          !state.hasStartedScreening &&
          ((state.peerPlayback && state.peerPlayback.playing) || state.instantSyncOverride)
        ) {
          setCurtainVisible(false);
          if (mainMovieVideo.paused) {
            safePlayMovieVideo();
            updatePlayButtonUI(true);
          }
        }
      }
    };

    mainMovieVideo.addEventListener('loadeddata', onFilmCanPlay);
    mainMovieVideo.addEventListener('canplay', onFilmCanPlay);

    // remote-stream-error-handler: 若正在边传边播期间遇到瞬时读取未就绪，自动重试挂载；若确认无片源才重置
    mainMovieVideo.addEventListener('error', () => {
      const streamAttr = mainMovieVideo.getAttribute('data-stream-url');
      if (streamAttr && !state.selectedFile) {
        const ft = state.filmTransfer || {};
        const knownFilm = Boolean(
          ft.active || ft.preloadReady || ft.streamReady || ft.ready ||
          (state.fileMeta && state.fileMeta.name && !state.fileMeta.isDemo)
        );
        if (knownFilm) {
          // 这段影片还没装到（服务端 503 / 等待超时）：不限次数按 1.5s→10s 退避重试，保留播放位置和播放意图
          const retries = (state.streamErrorRetryCount || 0) + 1;
          state.streamErrorRetryCount = retries;
          const delay = Math.min(10000, Math.round(1500 * Math.pow(1.6, retries - 1)));
          rememberStreamResumePoint();
          const t = state.streamResume ? state.streamResume.time : (mainMovieVideo.currentTime || 0);
          requestFilmPriorityAt(t, 'stream_error');
          if (state.hasStartedScreening && state.peerCount >= 2 && !state.isLocalBuffering && !state.activeSeek) {
            state.isLocalBuffering = true;
            sendSignal({ type: 'peer_buffering', buffering: true, currentTime: t, sentAt: Date.now() });
          }
          if (state.hasStartedScreening || state.activeSeek) {
            showSharePlayActionToast('⏳', loadingWaitText(estimateLoadEtaSec(t)), { persistent: true });
          }
          if (state.streamRetryTimer) clearTimeout(state.streamRetryTimer);
          state.streamRetryTimer = setTimeout(() => {
            state.streamRetryTimer = null;
            if (!state.selectedFile && mainMovieVideo.getAttribute('data-stream-url') === streamAttr) {
              reloadRemoteStream('error');
            }
          }, delay);
          return;
        }
        mainMovieVideo.removeAttribute('data-stream-url');
        mainMovieVideo.removeAttribute('src');
        state.localFilmReady = false;
        state.fileMeta = null;
        state.filmTransfer.active = false;
        state.filmTransfer.ready = false;
        updateCurtainAndReadinessUI();
        if (curtainSubtext) {
          curtainSubtext.textContent = ''; curtainSubtext.classList.add('hidden'); curtainSubtext.hidden = true;
        }
      }
    });

    // 重新挂载片源后回到原来的位置，并保持原来的播放意图
    mainMovieVideo.addEventListener('loadedmetadata', () => {
      const r = state.streamResume;
      if (!r || state.selectedFile) return;
      state.streamResume = null;
      state.suppressSyncEmit = true;
      try {
        if (r.time > 0.2) mainMovieVideo.currentTime = r.time;
      } catch {}
      if (r.play) safePlayMovieVideo();
      setTimeout(() => { state.suppressSyncEmit = false; }, 150);
    });

    const clearLocalBufferingState = () => {
      if (state.bufferingTimer) {
        clearTimeout(state.bufferingTimer);
        state.bufferingTimer = null;
      }
      if (state.isLocalBuffering) {
        state.isLocalBuffering = false;
        clearPersistentActionToast();
        sendSignal({
          type: 'peer_buffering',
          buffering: false,
          currentTime: mainMovieVideo.currentTime,
          playing: !mainMovieVideo.paused,
          sentAt: Date.now()
        });
        updateLiveSyncUI();
      }
    };

    // 监听网络缓冲与恢复：仅当画面真实停滞超过 1.6 秒才进入缓冲等待，过滤跨境网络瞬时微抖动，彻底消除假性「本机缓冲中」与互锁卡顿
    mainMovieVideo.addEventListener('waiting', () => {
      if (mainMovieVideo.paused || !state.roomCode || state.peerCount < 2) return;
      const stallTimeSnapshot = mainMovieVideo.currentTime || 0;
      if (state.bufferingTimer) clearTimeout(state.bufferingTimer);
      state.bufferingTimer = setTimeout(() => {
        const progressed = Math.abs((mainMovieVideo.currentTime || 0) - stallTimeSnapshot);
        if (!mainMovieVideo.paused && mainMovieVideo.readyState < 3 && progressed < 0.08 && !state.isLocalBuffering) {
          state.isLocalBuffering = true;
          sendSignal({
            type: 'peer_buffering',
            buffering: true,
            currentTime: mainMovieVideo.currentTime,
            sentAt: Date.now()
          });
          showSharePlayActionToast('⏳', `正在加载画面（${formatCinemaTime(mainMovieVideo.currentTime)}），TA 已停下等你…`, { persistent: true });
          updateLiveSyncUI();
        }
      }, 1600);
    });

    mainMovieVideo.addEventListener('playing', clearLocalBufferingState);
    mainMovieVideo.addEventListener('canplay', clearLocalBufferingState);
    mainMovieVideo.addEventListener('canplaythrough', clearLocalBufferingState);

    mainMovieVideo.addEventListener('seeked', () => {
      checkAndReportLocalSeekReady();
    });
    mainMovieVideo.addEventListener('canplay', () => {
      checkAndReportLocalSeekReady();
    });

    mainMovieVideo.addEventListener('timeupdate', () => {
      const cur = mainMovieVideo.currentTime || 0;
      const dur = mainMovieVideo.duration || 0;
      if (Math.abs(cur - state.lastPlayheadTime) > 0.08) {
        state.lastPlayheadTime = cur;
        state.lastPlayheadMovedAt = Date.now();
        if (state.isLocalBuffering && !mainMovieVideo.paused) {
          clearLocalBufferingState();
        }
      }
      if (!state.isDraggingTimeline) {
        const pct = dur > 0 ? (cur / dur) * 100 : 0;
        timelineSlider.value = String(pct.toFixed(1));
        updateSliderProgressTrack(pct);
        timeReadout.textContent = `${formatCinemaTime(cur)} / ${formatCinemaTime(dur)}`;
      }
      updateLiveSyncUI();
    });

    mainMovieVideo.addEventListener('play', () => {
      if (!state.suppressSyncEmit && state.autoPausedForLoading) {
        state.autoPausedForLoading = false;
        state.loadingPauseSuppressUntil = Date.now() + 20000;
      }
      state.hasStartedScreening = true;
      hideScreenPauseOverlay();
      clearLocalBufferingState();
      clearPersistentActionToast();
      setCurtainVisible(false);
      updatePlayButtonUI(true);
      if (!state.suppressSyncEmit) {
        sendSignal({
          type: 'sync_play',
          currentTime: mainMovieVideo.currentTime,
          playing: true,
          playbackRate: state.basePlaybackRate || mainMovieVideo.playbackRate,
          sentAt: Date.now()
        });
      }
      updateLiveSyncUI();
    });

    mainMovieVideo.addEventListener('pause', () => {
      clearLocalBufferingState();
      updatePlayButtonUI(false);
      if (!state.suppressSyncEmit) {
        if (state.hasStartedScreening && !mainMovieVideo.ended) {
          showScreenPauseOverlay('已暂停放映', formatCinemaTime(mainMovieVideo.currentTime));
        }
        sendSignal({
          type: 'sync_pause',
          currentTime: mainMovieVideo.currentTime,
          playing: false,
          playbackRate: mainMovieVideo.playbackRate,
          sentAt: Date.now()
        });
      }
    });

    if (screenPauseOverlay) {
      screenPauseOverlay.addEventListener('click', (e) => {
        e.stopPropagation();
        hideScreenPauseOverlay();
        ensureAudioContext();
        safePlayMovieVideo();
      });
    }

    if (resumeFromPauseBtn) {
      resumeFromPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideScreenPauseOverlay();
        ensureAudioContext();
        safePlayMovieVideo();
      });
    }

    if (volumeMixerBtn && volumeMixerPopover) {
      volumeMixerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        volumeMixerPopover.classList.toggle('hidden');
      });
      volumeMixerPopover.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      document.addEventListener('click', (e) => {
        if (volumeMixerWrap && !volumeMixerWrap.contains(e.target)) {
          volumeMixerPopover.classList.add('hidden');
        }
      });
    }

    if (movieVolumeSlider) {
      movieVolumeSlider.addEventListener('input', () => {
        applyUserMovieVolume(movieVolumeSlider.value);
      });
    }

    if (peerVolumeSlider) {
      peerVolumeSlider.addEventListener('input', () => {
        applyUserPeerVolume(peerVolumeSlider.value);
      });
    }

    playPauseBtn.addEventListener('click', () => {
      triggerStartOrTogglePlayback();
    });

    if (startScreeningBtn) {
      startScreeningBtn.addEventListener('click', () => {
        if (!state.fileMeta || !state.fileMeta.name || !state.localFilmReady) {
          localVideoFileInput.click();
          return;
        }
        if (!isScreeningReadyToStart()) return;
        state.instantSyncOverride = true;
        sendSignal({
          type: 'instant_zero_wait_start',
          currentTime: mainMovieVideo.currentTime || 0,
          playing: true,
          fileMeta: state.fileMeta,
          sentAt: Date.now()
        });
        ensureAudioContext();
        setCurtainVisible(false);
        safePlayMovieVideo();
      });
    }

    const setQualityMode = (mode) => {
      state.qualityMode = mode === 'original' ? 'original' : '720p';
      if (qualityOriginalBtn) qualityOriginalBtn.classList.toggle('is-active', state.qualityMode === 'original');
      if (qualityFast720Btn) qualityFast720Btn.classList.toggle('is-active', state.qualityMode === '720p');
      const label = state.qualityMode === '720p' ? '已切换为「720p 流畅优先」' : '已切换为「原画画质」';
      showSharePlayActionToast('🎞', label, { durationMs: 2000 });
    };
    if (qualityOriginalBtn) {
      qualityOriginalBtn.addEventListener('click', () => setQualityMode('original'));
    }
    if (qualityFast720Btn) {
      qualityFast720Btn.addEventListener('click', () => setQualityMode('720p'));
    }

    if (guestQuickMatchBtn) {
      guestQuickMatchBtn.addEventListener('click', () => {
        localVideoFileInput.click();
      });
    }

    // 按下/拖动进度条瞬间：立即暂停本机与对方画面，绝不边拖边播
    timelineSlider.addEventListener('input', () => {
      const dur = mainMovieVideo.duration || 0;
      if (dur <= 0) return;
      const pct = parseFloat(timelineSlider.value) || 0;
      const previewTime = (pct / 100) * dur;
      if (!state.isDraggingTimeline) {
        state.isDraggingTimeline = true;
        state.wasPlayingBeforeDrag = !mainMovieVideo.paused || Boolean(state.activeSeek && state.activeSeek.shouldPlayAfterAlign);
        state.suppressSyncEmit = true;
        if (!mainMovieVideo.paused) {
          mainMovieVideo.pause();
        }
        updatePlayButtonUI(false);
        setTimeout(() => { state.suppressSyncEmit = false; }, 100);
        if (state.peerCount >= 2) {
          sendSignal({
            type: 'sync_pause',
            currentTime: mainMovieVideo.currentTime || 0,
            playing: false,
            reason: 'seeking',
            sentAt: Date.now()
          });
        }
      }
      if (state.peerCount >= 2) {
        showScreenPauseOverlay('已暂停 · 正在调整进度', `跳至 ${formatCinemaTime(previewTime)} · 松手后双方对齐画面`);
      }
      updateSliderProgressTrack(pct);
      timeReadout.textContent = `${formatCinemaTime(previewTime)} / ${formatCinemaTime(dur)}`;
    });

    // 松手（change）时触发「双方保持暂停定格 -> 双方各自跳转准备就绪 -> 收到 seek_all_aligned 后同时恢复播放」
    timelineSlider.addEventListener('change', () => {
      const dur = mainMovieVideo.duration || 0;
      state.isDraggingTimeline = false;
      if (dur <= 0) return;

      const pct = parseFloat(timelineSlider.value) || 0;
      const targetTime = (pct / 100) * dur;
      const prevTime = mainMovieVideo.currentTime || 0;
      const shouldPlayAfterAlign = state.wasPlayingBeforeDrag !== undefined
        ? state.wasPlayingBeforeDrag
        : (!mainMovieVideo.paused || state.hasStartedScreening);
      state.wasPlayingBeforeDrag = undefined;

      const totalBytes = state.filmTransfer.totalBytes || (state.fileMeta && state.fileMeta.size) || 0;
      const approxByteOffset = totalBytes > 0 ? Math.floor((pct / 100) * totalBytes) : 0;
      state.autoPausedForLoading = false;
      requestFilmPriorityAt(targetTime, 'local_seek');

      const seekId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      state.activeSeek = {
        seekId,
        targetTime,
        shouldPlayAfterAlign,
        reportedReady: false
      };

      state.suppressSyncEmit = true;
      if (!mainMovieVideo.paused) {
        mainMovieVideo.pause();
      }
      updatePlayButtonUI(false);
      try {
        mainMovieVideo.currentTime = targetTime;
      } catch {}
      setTimeout(() => { state.suppressSyncEmit = false; }, 100);

      updateSliderProgressTrack(pct);
      timeReadout.textContent = `${formatCinemaTime(targetTime)} / ${formatCinemaTime(dur)}`;

      if (state.peerCount >= 2) {
        showScreenPauseOverlay('已暂停 · 正在对齐画面', `已跳至 ${formatCinemaTime(targetTime)} · 等 TA 画面跟上后自动继续`);
        showSharePlayActionToast('⏳', `已跳至 ${formatCinemaTime(targetTime)} · 等 TA 画面对齐后自动继续…`, { persistent: true });
      }

      const localAlreadyReady = Boolean(!mainMovieVideo.seeking && mainMovieVideo.readyState >= 2);
      if (localAlreadyReady) {
        state.activeSeek.reportedReady = true;
      }

      sendSignal({
        type: 'sync_seek',
        seekId,
        prevTime,
        currentTime: targetTime,
        playing: false,
        shouldPlayAfterAlign,
        localReady: localAlreadyReady,
        approxByteOffset,
        sentAt: Date.now()
      });

      if (state.peerCount < 2) {
        state.activeSeek = null;
        clearPersistentActionToast();
        hideScreenPauseOverlay();
        if (shouldPlayAfterAlign) {
          safePlayMovieVideo();
          updatePlayButtonUI(true);
        }
      } else if (!localAlreadyReady) {
        checkAndReportLocalSeekReady();
      }
    });

    playbackRateSelect.addEventListener('change', () => {
      const rate = parseFloat(playbackRateSelect.value) || 1;
      mainMovieVideo.playbackRate = rate;
      sendSignal({
        type: 'sync_rate',
        currentTime: mainMovieVideo.currentTime,
        playbackRate: rate,
        playing: !mainMovieVideo.paused,
        sentAt: Date.now()
      });
    });

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        toggleCinemaFullscreen();
      });
    }

    if (theaterStage) {
      theaterStage.addEventListener('dblclick', (e) => {
        if (e.target && e.target.closest('button')) return;
        toggleCinemaFullscreen();
      });
    }

    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

    if (liveSyncBadge) {
      liveSyncBadge.addEventListener('click', () => {
        if (state.peerCount >= 2 && state.peerPlayback.updatedAt > 0) {
          const targetTime = getEstimatedPeerCurrentTime();
          state.suppressSyncEmit = true;
          mainMovieVideo.playbackRate = state.basePlaybackRate || 1.0;
          mainMovieVideo.currentTime = targetTime;
          state.lastHardSyncAt = Date.now();
          if (state.peerPlayback.playing && mainMovieVideo.paused && state.localFilmReady) {
            setCurtainVisible(false);
            safePlayMovieVideo();
            updatePlayButtonUI(true);
          }
          setTimeout(() => { state.suppressSyncEmit = false; }, 80);
          showSharePlayActionToast('✨', `已与 TA 的画面实时对齐（${formatCinemaTime(targetTime)}）`, { durationMs: 2000 });
          updateLiveSyncUI();
        }
      });
    }

    setInterval(() => {
      if (state.roomCode && state.localFilmReady && (!mainMovieVideo.paused || state.isLocalBuffering)) {
        sendSignal({
          type: 'sync_heartbeat',
          currentTime: mainMovieVideo.currentTime,
          playing: !mainMovieVideo.paused,
          buffering: Boolean(state.isLocalBuffering),
          playbackRate: state.basePlaybackRate || mainMovieVideo.playbackRate,
          sentAt: Date.now()
        });
      }
      updateLiveSyncUI();
    }, 2000);

    // 1 秒看门狗：互相等待、片源卡住、装入边缘自动停下
    setInterval(() => {
      try {
        playbackWatchdogTick(clearLocalBufferingState);
      } catch (err) {
        console.warn('[watchdog]', err);
      }
    }, 1000);
  }

  function rememberStreamResumePoint() {
    if (state.streamResume) return;
    const cur = mainMovieVideo.currentTime || 0;
    const time = state.activeSeek ? state.activeSeek.targetTime : (cur > 0.2 ? cur : (state.lastGoodRemoteTime || 0));
    const play = state.activeSeek
      ? false
      : Boolean(!mainMovieVideo.paused || state.isLocalBuffering || (state.hasStartedScreening && state.peerPlayback && state.peerPlayback.playing));
    state.streamResume = { time, play };
  }

  function reloadRemoteStream(reason) {
    const base = mainMovieVideo.getAttribute('data-stream-url');
    if (!base || state.selectedFile || state.sameFileMatched) return;
    rememberStreamResumePoint();
    state.streamReloadSeq = (state.streamReloadSeq || 0) + 1;
    const sep = base.includes('?') ? '&' : '?';
    console.info('[stream] reload', reason, state.streamResume);
    state.suppressSyncEmit = true;
    mainMovieVideo.src = `${base}${sep}retry=${state.streamReloadSeq}`;
    mainMovieVideo.load();
    setTimeout(() => { state.suppressSyncEmit = false; }, 150);
  }

  function forceResumeTogether(source) {
    if (state.activeSeek) state.abandonedSeekId = state.activeSeek.seekId;
    state.activeSeek = null;
    state.isPeerBuffering = false;
    state.pausedForPeerBuffering = false;
    state.peerBufferingSince = 0;
    state.peerWaitStartedAt = 0;
    state.peerWaitSkipOffered = false;
    clearPersistentActionToast();
    hideScreenPauseOverlay();
    setCurtainVisible(false);
    if (mainMovieVideo.paused) {
      safePlayMovieVideo(); // play 事件会发出 sync_play，TA 那边收到后也会结束等待
    } else {
      sendSignal({
        type: 'sync_play',
        currentTime: mainMovieVideo.currentTime,
        playing: true,
        playbackRate: state.basePlaybackRate || mainMovieVideo.playbackRate,
        sentAt: Date.now()
      });
    }
    updatePlayButtonUI(true);
    showSharePlayActionToast('▶', source === 'auto' ? '等了一会儿，先继续放映 · TA 那边好了会自动跟上' : '不等了 · 继续放映', { durationMs: 2600 });
    updateLiveSyncUI();
  }

  function sendLoadingPause(etaSec) {
    sendSignal({
      type: 'sync_pause',
      currentTime: mainMovieVideo.currentTime,
      playing: false,
      reason: 'loading',
      etaSec: etaSec || 0,
      playbackRate: mainMovieVideo.playbackRate,
      sentAt: Date.now()
    });
  }

  function playbackWatchdogTick(clearLocalBufferingState) {
    const now = Date.now();
    const v = mainMovieVideo;
    const isRemoteStream = Boolean(v.getAttribute('data-stream-url')) && !state.selectedFile && !state.sameFileMatched;

    if (v.readyState >= 2 && !v.seeking && isRemoteStream) {
      state.lastGoodRemoteTime = v.currentTime || state.lastGoodRemoteTime;
    }

    // a) 画面数据已经够了（即使暂停着）就告诉 TA 不用再等我
    if (state.isLocalBuffering && v.readyState >= 3 && !v.seeking) {
      clearLocalBufferingState();
    }

    // b) 我在等 TA：8 秒给「不等了」按钮，20 秒自动一起继续
    const waitingForPeer = state.peerCount >= 2 && (
      (state.isPeerBuffering && state.pausedForPeerBuffering) ||
      (state.activeSeek && state.activeSeek.reportedReady && state.activeSeek.shouldPlayAfterAlign)
    );
    if (waitingForPeer) {
      if (!state.peerWaitStartedAt) state.peerWaitStartedAt = now;
      const waited = now - state.peerWaitStartedAt;
      if (waited >= 20000) {
        forceResumeTogether('auto');
      } else if (waited >= 8000 && !state.peerWaitSkipOffered) {
        state.peerWaitSkipOffered = true;
        showSharePlayActionToast('⏳', 'TA 那边还在加载画面 · 不等了，直接继续', {
          persistent: true,
          onClick: () => forceResumeTogether('manual')
        });
      }
    } else {
      state.peerWaitStartedAt = 0;
      state.peerWaitSkipOffered = false;
    }

    // c) 我这边看的是远程片源且卡住了：请上传方优先补这一段，长时间卡住就原位重新挂载
    const wantsFrames = isRemoteStream && (
      (state.activeSeek && !state.activeSeek.reportedReady) ||
      (!v.paused && state.hasStartedScreening)
    );
    if (wantsFrames && v.readyState < 3 && !state.filmTransfer.ready) {
      if (!state.remoteStallSince) state.remoteStallSince = now;
      const t = state.activeSeek ? state.activeSeek.targetTime : (v.currentTime || 0);
      if (now - (state.lastPriorityRequestAt || 0) >= 4000) requestFilmPriorityAt(t, 'stall');
      if (now - state.remoteStallSince >= 12000 && !state.streamRetryTimer) {
        state.remoteStallSince = now;
        state.remoteStallReloads = (state.remoteStallReloads || 0) + 1;
        reloadRemoteStream('watchdog');
      }
    } else if (wantsFrames && v.readyState < 3) {
      if (!state.remoteStallSince) state.remoteStallSince = now;
      if (now - state.remoteStallSince >= 12000 && !state.streamRetryTimer) {
        state.remoteStallSince = now;
        reloadRemoteStream('watchdog');
      }
    } else {
      state.remoteStallSince = 0;
    }

    // d) 我是上传方：两人一起看时，播放头追上装入边缘（不足 3 秒）就两边一起停下，装够了再一起继续
    const ft = state.filmTransfer || {};
    if (state.myUploadId && ft.active && !ft.ready && state.peerCount >= 2 && state.hasStartedScreening) {
      const cur = v.currentTime || 0;
      const ahead = getLoadedAheadSec(cur);
      if (!state.autoPausedForLoading) {
        if (!v.paused && !state.activeSeek && now > (state.loadingPauseSuppressUntil || 0) && ahead < 3) {
          state.autoPausedForLoading = true;
          state.lastLoadingToastAt = now;
          const eta = estimateLoadEtaSec(cur);
          state.suppressSyncEmit = true;
          v.pause();
          setTimeout(() => { state.suppressSyncEmit = false; }, 120);
          updatePlayButtonUI(false);
          sendLoadingPause(eta);
          requestFilmPriorityAt(cur, 'edge');
          const text = loadingWaitText(eta);
          showScreenPauseOverlay('影片还在装入', text);
          showSharePlayActionToast('⏳', text, { persistent: true });
        }
      } else if (ahead >= 20 || ahead === Infinity || (v.duration > 0 && cur + ahead >= v.duration - 0.5)) {
        state.autoPausedForLoading = false;
        state.loadingPauseSuppressUntil = now + 5000;
        clearPersistentActionToast();
        hideScreenPauseOverlay();
        safePlayMovieVideo(); // 发出 sync_play，两边一起继续
        updatePlayButtonUI(true);
      } else if (now - (state.lastLoadingToastAt || 0) >= 5000) {
        state.lastLoadingToastAt = now;
        const eta = estimateLoadEtaSec(cur);
        sendLoadingPause(eta);
        const text = loadingWaitText(eta);
        showScreenPauseOverlay('影片还在装入', text);
        showSharePlayActionToast('⏳', text, { persistent: true });
      }
    } else if (state.autoPausedForLoading && (ft.ready || !state.myUploadId)) {
      state.autoPausedForLoading = false;
      if (ft.ready && state.hasStartedScreening && v.paused) {
        clearPersistentActionToast();
        hideScreenPauseOverlay();
        safePlayMovieVideo();
        updatePlayButtonUI(true);
      }
    }
  }

  // 7. Web Audio API 智能语音闪避 (0.2s 平滑轻落至 25%，1.0s 后恢复 100%)
  function ensureAudioContext() {
    if (!state.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        state.audioCtx = new AudioCtx();
      }
    }
    if (state.audioCtx && state.audioCtx.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
  }

  function setupAudioAnalyserForStream(stream, kind) {
    if (!stream || stream.getAudioTracks().length === 0) return;
    ensureAudioContext();
    if (!state.audioCtx) return;

    try {
      const source = state.audioCtx.createMediaStreamSource(stream);
      const analyser = state.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);

      if (kind === 'local') {
        state.localAnalyser = analyser;
      } else {
        state.remoteAnalyser = analyser;
        const gainNode = state.audioCtx.createGain();
        gainNode.gain.value = state.peerMuted ? 0 : (state.userPeerVolume > 1 ? (state.userPeerVolume - 1.0) : 0);
        source.connect(gainNode);
        gainNode.connect(state.audioCtx.destination);
        state.remoteGainNode = gainNode;
      }
    } catch {}
  }

  function computeRmsEnergy(analyser) {
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) {
      const norm = (buf[i] - 128) / 128;
      sumSq += norm * norm;
    }
    return Math.sqrt(sumSq / buf.length);
  }

  function setDuckingActive(speaking, speakerWho) {
    state.isSpeaking = speaking;

    if (!state.duckingEnabled) {
      state.targetVolume = state.userMovieVolume;
      if (!state.actionToastPersistent && !state.actionToastTimer) {
        duckingStatusToast.classList.add('silent');
      }
      partnerSeatCard.classList.remove('is-speaking');
      selfSeatCard.classList.remove('is-speaking');
      if (seatPartnerWave) seatPartnerWave.classList.add('hidden');
      pipPeerLabel.textContent = state.peerCount >= 2 ? '' : '';
      if (movieVolumeText) if (movieVolumeText) if (movieVolumeText) movieVolumeText.textContent = '100% (说话自动压音已关闭)';
      return;
    }

    if (speaking) {
      state.targetVolume = Math.min(state.userMovieVolume, DUCK_TARGET_VOLUME);
      // Designer v0.7：说话压音只保留声波动画，不写说明文案
      if (!state.actionToastPersistent && !state.actionToastTimer) {
        duckingStatusToast.classList.remove('is-action-toast');
        if (toastActionBadge) toastActionBadge.classList.add('hidden');
        if (voiceWaveBars) voiceWaveBars.classList.remove('hidden');
        if (duckingToastText) {
          duckingToastText.textContent = '';
          duckingToastText.classList.add('hidden');
        }
        duckingStatusToast.classList.remove('silent');
      }
      if (speakerWho === 'local') {
        selfSeatCard.classList.add('is-speaking');
      } else {
        partnerSeatCard.classList.add('is-speaking');
        if (seatPartnerWave) seatPartnerWave.classList.remove('hidden');
        pipPeerLabel.textContent = '';
      }
      movieVolumeText.textContent = '25%';
    } else {
      state.targetVolume = state.userMovieVolume;
      if (!state.actionToastPersistent && !state.actionToastTimer) {
        duckingStatusToast.classList.add('silent');
      }
      partnerSeatCard.classList.remove('is-speaking');
      selfSeatCard.classList.remove('is-speaking');
      if (seatPartnerWave) seatPartnerWave.classList.add('hidden');
      pipPeerLabel.textContent = state.peerCount >= 2 ? '' : '';
      movieVolumeText.textContent = '100% (银幕原声 · 说话自动压至 25%)';
    }
  }

  function toggleDuckingEnabled() {
    state.duckingEnabled = !state.duckingEnabled;
    localStorage.setItem('loamly_ducking_v2', state.duckingEnabled ? '1' : '0');
    updateDuckingSwitchUI();
    setDuckingActive(state.isSpeaking);
  }

  function startAudioDuckingLoop() {
    let lastTick = performance.now();

    function tick(now) {
      const dt = Math.max(1, now - lastTick);
      lastTick = now;

      if (state.roomCode) {
        const localRms = state.micEnabled ? computeRmsEnergy(state.localAnalyser) : 0;
        const remoteRms = computeRmsEnergy(state.remoteAnalyser);
        const maxRms = Math.max(localRms, remoteRms);

        if (maxRms > 0.035 || state.simulatedSpeaking) {
          state.lastVoiceTimestamp = Date.now();
          const who = state.simulatedSpeaking
            ? 'remote'
            : (localRms >= remoteRms ? 'local' : 'remote');
          if (!state.isSpeaking) {
            setDuckingActive(true, who);
            if (localRms > 0.035) {
              sendSignal({ type: 'peer_speaking', speaking: true });
            }
          }
        } else if (state.isSpeaking && (Date.now() - state.lastVoiceTimestamp > DUCK_RELEASE_DELAY_MS)) {
          setDuckingActive(false);
        }

        const step = dt / DUCK_ATTACK_MS;
        if (Math.abs(state.currentVolume - state.targetVolume) > 0.005) {
          if (state.currentVolume > state.targetVolume) {
            state.currentVolume = Math.max(state.targetVolume, state.currentVolume - step * (1 - DUCK_TARGET_VOLUME));
          } else {
            state.currentVolume = Math.min(state.targetVolume, state.currentVolume + (dt / 400) * (1 - DUCK_TARGET_VOLUME));
          }
          mainMovieVideo.volume = Math.max(0, Math.min(1, state.currentVolume));
        }
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  // 8. 本地摄像头采集与动态推流
  function initLocalMediaCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(null);
    }

    const videoConstraints = {
      facingMode: state.facingMode,
      width: { ideal: 480, max: 640 },
      height: { ideal: 360, max: 480 },
      frameRate: { ideal: 30, max: 30 }
    };
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };

    const p = (async () => {
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audioConstraints
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false
          });
        } catch {}
      }

      if (!stream) return null;

      state.localStream = stream;
      state.localStream.getAudioTracks().forEach((t) => {
        t.enabled = state.micEnabled;
      });

      localCamVideo.srcObject = stream;
      localCamVideo.classList.remove('hidden');
      localPortraitImg.classList.add('hidden');
      localCamVideo.play().catch(() => {});
      localCamFacingTag.textContent = state.micEnabled ? '' : '我 · 麦克风已静默';
      setupAudioAnalyserForStream(stream, 'local');

      if (state.pc && state.hasCompletedInitialHandshake && state.pc.connectionState !== 'closed') {
        const addedNewTrack = attachLocalTracksToPeerConnection(state.pc);
        if (addedNewTrack) {
          await renegotiatePeerConnection();
        }
      }
      return stream;
    })();

    state.localCameraPromise = p;
    return p;
  }

  function setupDesktopBoothDrag() {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    pipFloatingWindow.addEventListener('pointerdown', (e) => {
      if (window.innerWidth <= 860) return;
      dragging = true;
      pipFloatingWindow.setPointerCapture(e.pointerId);
      const wrapperRect = pipFloatingWindow.parentElement.getBoundingClientRect();
      const rect = pipFloatingWindow.getBoundingClientRect();

      initialLeft = rect.left - wrapperRect.left;
      initialTop = rect.top - wrapperRect.top;
      pipFloatingWindow.style.right = 'auto';
      pipFloatingWindow.style.bottom = 'auto';
      pipFloatingWindow.style.left = `${initialLeft}px`;
      pipFloatingWindow.style.top = `${initialTop}px`;

      startX = e.clientX;
      startY = e.clientY;
    });

    pipFloatingWindow.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const wrapperRect = pipFloatingWindow.parentElement.getBoundingClientRect();
      const rect = pipFloatingWindow.getBoundingClientRect();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const maxLeft = Math.max(0, wrapperRect.width - rect.width - 8);
      const maxTop = Math.max(0, wrapperRect.height - rect.height - 8);

      pipFloatingWindow.style.left = `${Math.max(8, Math.min(maxLeft, initialLeft + dx))}px`;
      pipFloatingWindow.style.top = `${Math.max(8, Math.min(maxTop, initialTop + dy))}px`;
    });

    const stopDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      try { pipFloatingWindow.releasePointerCapture(e.pointerId); } catch {}
    };

    pipFloatingWindow.addEventListener('pointerup', stopDrag);
    pipFloatingWindow.addEventListener('pointercancel', stopDrag);
  }

  // 9. 开启私人放映厅（绝不在访客入房时误挂默认 Demo，严格同步房主片源）
  async function enterScreeningRoom({ mode, file, roomCode, isDemo = false }) {
    homeView.classList.add('hidden');
    lobbyEditionLabel.classList.add('hidden');
    roomView.classList.remove('hidden');
    roomHeaderActions.classList.remove('hidden');

    const preferredCode = (roomCode || '').trim().toUpperCase();
    state.roomCode = preferredCode || '3G6H';
    state.role = mode === 'create' ? 'host' : 'join';
    roomCodeBadge.textContent = `NO. ${state.roomCode}`;

    if (file) {
      state.selectedFile = file;
      state.fileMeta = {
        name: file.name,
        size: file.size,
        type: file.type || 'video/mp4',
        isDemo: false
      };
      state.localFilmReady = true;
      currentFileName.textContent = file.name;
      if (curtainFilmTitle) curtainFilmTitle.textContent = file.name;
      mainMovieVideo.removeAttribute('data-stream-url');
      mainMovieVideo.src = URL.createObjectURL(file);
    } else if (isDemo) {
      state.selectedFile = null;
      state.fileMeta = {
        name: '试看短片',
        size: 6165240,
        type: 'video/mp4',
        isDemo: true
      };
      state.localFilmReady = true;
      currentFileName.textContent = '试看短片';
      if (curtainFilmTitle) curtainFilmTitle.textContent = '试看短片';
      mainMovieVideo.removeAttribute('data-stream-url');
      mainMovieVideo.src = '/demo-clip.mp4';
    } else {
      // 访客通过 ?room=XXXX 或输入房间码进入：在拿到房间片源前绝不加载 /demo-clip.mp4
      state.selectedFile = null;
      state.fileMeta = null;
      state.localFilmReady = false;
      currentFileName.textContent = '正在同步房间片源…';
      if (curtainFilmTitle) curtainFilmTitle.textContent = '正在同步房主的放映画面…';
      mainMovieVideo.removeAttribute('src');
      mainMovieVideo.removeAttribute('data-stream-url');
      mainMovieVideo.load();
    }

    mainMovieVideo.pause();
    mainMovieVideo.currentTime = 0;
    mainMovieVideo.volume = 1.0;
    state.currentVolume = 1.0;
    state.targetVolume = 1.0;
    state.simulatedSpeaking = false;
    state.hasStartedScreening = false;

    updatePlayButtonUI(false);
    updateSliderProgressTrack(0);
    timeReadout.textContent = "00:00 / 00:00";
    setCurtainVisible(true);
    updateDuckingSwitchUI();
    setDuckingActive(false);
    updateCurtainAndReadinessUI();

    requestScreenWakeLock();
    initLocalMediaCamera();

    connectWebSocket(() => {
      if (mode === 'create') {
        sendSignal({
          type: 'create_room',
          roomCode: preferredCode,
          fileMeta: state.fileMeta,
          hasLocalFile: Boolean(state.selectedFile),
          ...queueIdentity()
        });
      } else {
        sendSignal({
          type: 'join_room',
          roomCode: preferredCode,
          fileMeta: state.selectedFile ? state.fileMeta : null,
          hasLocalFile: Boolean(state.selectedFile),
          ...queueIdentity()
        });
      }
    });
  }

  // ==================== 本场待放映（v0.7）====================
  const WEB_VERSION = '0.7';
  const QUEUE_MAX_ITEMS = 3;
  const QUEUE_MAX_FILM_BYTES = 4 * 1024 * 1024 * 1024;
  const QUEUE_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
  const QUEUE_COPY = {
    tooBig: '这部影片超过 4GB · 换个小一点的文件试试',
    full: '最多放 3 部 · 先移出一部再加',
    total: '加上这部会超过本场 8GB · 先移出一部再加',
    declined: 'TA 想先看完这段',
    notReadyMine: '这部还没装进来 · 重新选一下这个文件就能接着装',
    notReadyTa: 'TA 加的这部还没装进来 · 等 TA 回来就接着装',
    older: '页面有新版本 · 刷新一下再开场',
    peerOlder: 'TA 的页面不是最新版 · 让 TA 刷新一下'
  };

  const queuePanel = document.getElementById('queuePanel');
  const queueList = document.getElementById('queueList');
  const queueCount = document.getElementById('queueCount');
  const queueToggleBtn = document.getElementById('queueToggleBtn');
  const queueBadge = document.getElementById('queueBadge');
  const queueCloseBtn = document.getElementById('queueCloseBtn');
  const queueGrab = document.getElementById('queueGrab');
  const queueAddBtn = document.getElementById('queueAddBtn');
  const queueCaption = document.getElementById('queueCaption');
  const queueFileInput = document.getElementById('queueFileInput');
  const queueAsk = document.getElementById('queueAsk');
  const queueAskTitle = document.getElementById('queueAskTitle');
  const queueAskOk = document.getElementById('queueAskOk');
  const queueAskLater = document.getElementById('queueAskLater');
  const versionNotice = document.getElementById('versionNotice');

  state.queue = { items: [], nowPlayingId: null, uploadTurn: null, totalBytes: 0 };
  state.queueFiles = new Map();
  state.bgUpload = null;
  state.pendingQueueResume = null;
  state.queueAskId = null;
  state.queueSwitchedAt = 0;
  state.versionInfo = { server: null, peerVersion: null };

  state.peerKey = (() => {
    try {
      let k = sessionStorage.getItem('loamly_peer_key');
      if (!k) {
        k = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem('loamly_peer_key', k);
      }
      return k;
    } catch {
      return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }
  })();

  function queueIdentity() {
    return { peerKey: state.peerKey, webVersion: WEB_VERSION, queueHave: Array.from(state.queueFiles.keys()) };
  }

  function registerQueueFile(uploadId, file) {
    if (!uploadId || !file) return;
    state.queueFiles.set(uploadId, file);
    reportQueueHave();
  }

  function reportQueueHave() {
    sendSignal({ type: 'queue_have', ids: Array.from(state.queueFiles.keys()) });
  }

  function formatFilmDuration(sec) {
    if (!(sec > 0) || !isFinite(sec)) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function queueItemStatus(it) {
    const q = state.queue;
    if (it.id === q.nowPlayingId) return { text: '放映中', cls: 'gold', dot: true };
    if (it.ready) return { text: '已装好', cls: 'gold' };
    if (it.streamReady) return { text: '可以先开始', cls: 'gold' };
    if (it.id === q.uploadTurn && (it.pct > 0 || (state.bgUpload && state.bgUpload.itemId === it.id))) {
      return { text: `正在装入 · ${Math.max(0, Math.min(99, Math.floor(it.pct || 0)))}%`, cls: '' };
    }
    return { text: '排队中', cls: 'grey' };
  }

  function showQueueCaption(text, ms = 0) {
    if (!queueCaption) return;
    if (state.queueCaptionTimer) { clearTimeout(state.queueCaptionTimer); state.queueCaptionTimer = null; }
    state.queueCaptionFlash = text || '';
    if (ms > 0) {
      state.queueCaptionTimer = setTimeout(() => { state.queueCaptionFlash = ''; renderQueue(); }, ms);
    }
    renderQueue();
  }

  function renderQueue() {
    const q = state.queue;
    const items = q.items || [];
    if (queueCount) queueCount.textContent = `${items.length} / ${QUEUE_MAX_ITEMS}`;
    if (queueBadge) {
      queueBadge.textContent = String(items.length);
      queueBadge.classList.toggle('hidden', items.length === 0);
    }
    if (queueList) {
      queueList.innerHTML = '';
      for (const it of items) {
        const mine = it.ownerKey === state.peerKey;
        const isNow = it.id === q.nowPlayingId;
        const st = queueItemStatus(it);
        const el = document.createElement('div');
        el.className = `queue-item${isNow ? ' now' : ''}`;
        el.dataset.id = it.id;
        const n = document.createElement('div');
        n.className = 'queue-item-name';
        n.textContent = (it.name || '').replace(/\.(mp4|mov|m4v|webm|mkv)$/i, '');
        n.title = it.name || '';
        const meta = document.createElement('div');
        meta.className = 'queue-item-meta';
        const who = document.createElement('span');
        const dur = formatFilmDuration(it.duration);
        who.textContent = `${mine ? '你加入的' : 'TA 加入的'}${dur ? ` · ${dur}` : ''}`;
        who.className = 'queue-item-who';
        const stEl = document.createElement('span');
        stEl.className = `queue-item-status ${st.cls || ''}`;
        stEl.dataset.status = st.text;
        if (st.dot) {
          const d = document.createElement('span');
          d.className = 'queue-dot';
          stEl.appendChild(d);
        }
        stEl.appendChild(document.createTextNode(st.text));
        meta.appendChild(who);
        meta.appendChild(stEl);
        el.appendChild(n);
        el.appendChild(meta);
        if (!it.ready && (it.pct > 0 || it.streamReady)) {
          const bar = document.createElement('div');
          bar.className = 'queue-bar';
          const i = document.createElement('i');
          i.style.width = `${Math.max(1, Math.min(100, it.pct || 0))}%`;
          bar.appendChild(i);
          el.appendChild(bar);
        }
        const canPlay = !isNow && it.canSwitch;
        const canRemove = mine && !isNow;
        if (canPlay || canRemove) {
          const acts = document.createElement('div');
          acts.className = 'queue-item-actions';
          if (canPlay) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'queue-play';
            b.textContent = '放这部 →';
            b.addEventListener('click', (e) => { e.stopPropagation(); requestQueueSwitch(it.id); });
            acts.appendChild(b);
          } else {
            acts.appendChild(document.createElement('span'));
          }
          if (canRemove) {
            const r = document.createElement('button');
            r.type = 'button';
            r.className = 'queue-remove';
            r.textContent = '移出待放映';
            r.addEventListener('click', (e) => { e.stopPropagation(); removeQueueItem(it.id); });
            acts.appendChild(r);
          }
          el.appendChild(acts);
        }
        queueList.appendChild(el);
      }
    }
    const full = items.length >= QUEUE_MAX_ITEMS;
    if (queueAddBtn) {
      queueAddBtn.classList.toggle('is-full', full);
      queueAddBtn.setAttribute('aria-disabled', full ? 'true' : 'false');
    }
    if (queueCaption) {
      const text = state.queueCaptionFlash || (full ? QUEUE_COPY.full : '');
      queueCaption.textContent = text;
      queueCaption.classList.toggle('hidden', !text);
    }
  }

  function isQueuePanelOpen() {
    return Boolean(queuePanel && !queuePanel.classList.contains('hidden'));
  }

  function setQueuePanelOpen(open) {
    if (!queuePanel) return;
    queuePanel.classList.toggle('hidden', !open);
    document.body.classList.toggle('queue-open', Boolean(open));
    if (queueToggleBtn) {
      queueToggleBtn.classList.toggle('is-on', Boolean(open));
      queueToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (open) renderQueue();
  }

  function checkQueueLimits(file) {
    const items = state.queue.items || [];
    if (file.size > QUEUE_MAX_FILM_BYTES) return QUEUE_COPY.tooBig;
    if (items.length >= QUEUE_MAX_ITEMS) return QUEUE_COPY.full;
    const used = items.reduce((a, it) => a + (Number(it.size) || 0), 0);
    if (used + file.size > QUEUE_MAX_TOTAL_BYTES) return QUEUE_COPY.total;
    return '';
  }

  function findMyQueueItemForFile(file) {
    return (state.queue.items || []).find((it) => it.ownerKey === state.peerKey && it.name === file.name && Number(it.size) === Number(file.size)) || null;
  }

  async function addFilmToQueue(file) {
    if (!file || !state.roomCode) return;
    const existing = findMyQueueItemForFile(file);
    if (existing) {
      registerQueueFile(existing.id, file);
      showSharePlayActionToast('↻', existing.ready ? '这部已经在待放映里了' : '这部已经在待放映里 · 接着装', { durationMs: 2600 });
      return;
    }
    const err = checkQueueLimits(file);
    if (err) {
      showQueueCaption(err, err === QUEUE_COPY.full ? 0 : 4200);
      showSharePlayActionToast('ⓘ', err, { durationMs: 3200 });
      return;
    }
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const edge = await probeEdgeR2Available();
    let duration = 0;
    try { duration = await readLocalFilmDuration(file); } catch {}
    state.queueFiles.set(uploadId, file);
    sendSignal({
      type: 'queue_add',
      uploadId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'video/mp4',
      duration: duration || 0,
      edge,
      chunkSize: edge ? 4 * 1024 * 1024 : 1024 * 1024
    });
  }

  function removeQueueItem(id) {
    const it = (state.queue.items || []).find((x) => x.id === id);
    if (!it || it.ownerKey !== state.peerKey || it.id === state.queue.nowPlayingId) return;
    if (state.bgUpload && state.bgUpload.itemId === id) stopBackgroundUpload();
    state.queueFiles.delete(id);
    sendSignal({ type: 'queue_remove', id });
  }

  function requestQueueSwitch(id) {
    sendSignal({ type: 'queue_switch_request', id });
  }

  function closeQueueAsk() {
    if (queueAsk) queueAsk.classList.add('hidden');
    state.queueAskId = null;
  }

  // 真正换片：两边都收到 queue_switched
  function applyQueueSwitch(msg) {
    closeQueueAsk();
    const item = msg.item || {};
    state.queueSwitchedAt = Date.now();
    // 当前这部先停下（不发同步，服务端已记住看到的位置）
    state.suppressSyncEmit = true;
    try { mainMovieVideo.pause(); } catch {}
    setTimeout(() => { state.suppressSyncEmit = false; }, 200);
    state.hasStartedScreening = false;
    state.instantSyncOverride = false;
    state.activeSeek = null;
    state.isPeerBuffering = false;
    state.pausedForPeerBuffering = false;
    state.autoPausedForLoading = false;
    state.isLocalBuffering = false;
    state.sameFileMatched = false;
    state.streamResume = null;
    if (state.peerPlayback) state.peerPlayback.playing = false;
    state.peerFilmReady = false;
    state.pendingQueueResume = { id: msg.id, time: Number(msg.resumeTime) || 0, duration: Number(item.duration) || 0 };
    try { hideScreenPauseOverlay(); } catch {}
    clearPersistentActionToast();
    updatePlayButtonUI(false);

    const file = state.queueFiles.get(msg.id);
    const iAmOwner = msg.mode === 'owner' && msg.ownerKey === state.peerKey && file;
    if (iAmOwner) {
      if (state.bgUpload && state.bgUpload.itemId === msg.id) stopBackgroundUpload();
      state.selectedFile = file;
      state.fileMeta = { name: file.name, size: file.size, type: file.type || 'video/mp4', isDemo: false };
      currentFileName.textContent = file.name;
      if (curtainFilmTitle) curtainFilmTitle.textContent = file.name;
      mainMovieVideo.removeAttribute('data-stream-url');
      mainMovieVideo.src = URL.createObjectURL(file);
      setCurtainVisible(true);
      markLocalFilmReady(true);
      sendSignal({ type: 'file_meta', fileMeta: state.fileMeta, filmReady: true, isNewSelection: true, queueItemId: msg.id });
      const resume = { uploadId: msg.id };
      if (typeof item.edge === 'boolean') resume.edge = item.edge;
      if (item.chunkSize > 0) resume.chunkSize = item.chunkSize;
      uploadHostFilmToRoom(file, true, resume);
    } else {
      if (state.selectedFile || state.myUploadId) {
        stopMyUpload();
        state.selectedFile = null;
        state.uploadingFileRef = null;
      }
      state.role = 'guest';
      state.localFilmReady = false;
      mainMovieVideo.removeAttribute('src');
      mainMovieVideo.removeAttribute('data-stream-url');
      try { mainMovieVideo.load(); } catch {}
      const ft = msg.filmTransfer || {};
      state.filmTransfer = {
        active: !item.ready, ready: Boolean(item.ready), preloadReady: Boolean(item.streamReady || item.ready),
        streamReady: Boolean(item.streamReady || item.ready), pct: ft.pct || (item.ready ? 100 : 0),
        receivedBytes: ft.receivedBytes || 0, contiguousBytes: ft.contiguousBytes || 0, totalBytes: item.size || 0,
        speedBps: 0, streamUrl: null, ranges: ft.ranges || [], duration: item.duration || 0, startBytes: ft.startBytes || 0
      };
      state.currentUploadId = msg.id;
      state.fileMeta = msg.fileMeta || { name: item.name, size: item.size, type: item.type || 'video/mp4', isDemo: false, uploadId: msg.id };
      currentFileName.textContent = item.name || '';
      if (curtainFilmTitle) curtainFilmTitle.textContent = item.name || '';
      setCurtainVisible(true);
      if (msg.mode === 'stream' && msg.streamUrl) {
        attachRemoteRoomStream(msg.streamUrl, state.fileMeta, null);
      }
    }
    const resumeText = state.pendingQueueResume.time > 1 ? ` · 从 ${formatCinemaTime(state.pendingQueueResume.time)} 接着看` : '';
    showSharePlayActionToast('🎞', `换成《${(item.name || '').replace(/\.(mp4|mov|m4v|webm|mkv)$/i, '')}》${resumeText}`, { durationMs: 3600 });
    updateCurtainAndReadinessUI();
    reconcileBackgroundUpload();
  }

  function handleQueueMessage(msg) {
    switch (msg.type) {
      case 'queue_state': {
        state.queue = {
          items: Array.isArray(msg.items) ? msg.items : [],
          nowPlayingId: msg.nowPlayingId || null,
          uploadTurn: msg.uploadTurn || null,
          totalBytes: msg.totalBytes || 0
        };
        // 被移出的影片不再保留文件引用
        for (const id of Array.from(state.queueFiles.keys())) {
          if (!state.queue.items.some((it) => it.id === id) && id !== state.myUploadId) state.queueFiles.delete(id);
        }
        if (state.queueAskId && !state.queue.items.some((it) => it.id === state.queueAskId)) closeQueueAsk();
        renderQueue();
        reconcileBackgroundUpload();
        break;
      }
      case 'queue_added': {
        if (msg.existing && msg.requestId && state.queueFiles.has(msg.requestId)) {
          const f = state.queueFiles.get(msg.requestId);
          state.queueFiles.delete(msg.requestId);
          if (f) state.queueFiles.set(msg.id, f);
        }
        break;
      }
      case 'queue_error': {
        const map = { too_big: QUEUE_COPY.tooBig, full: QUEUE_COPY.full, total: QUEUE_COPY.total };
        let text = map[msg.code];
        if (msg.code === 'not_ready') text = msg.mine ? QUEUE_COPY.notReadyMine : QUEUE_COPY.notReadyTa;
        if (text) {
          if (msg.code !== 'not_ready') showQueueCaption(text, msg.code === 'full' ? 0 : 4200);
          showSharePlayActionToast('ⓘ', text, { durationMs: 3200 });
        }
        break;
      }
      case 'queue_switch_ask': {
        state.queueAskId = msg.id;
        if (queueAskTitle) queueAskTitle.textContent = `TA 想换成《${String(msg.name || '').replace(/\.(mp4|mov|m4v|webm|mkv)$/i, '')}》`;
        if (queueAsk) queueAsk.classList.remove('hidden');
        break;
      }
      case 'queue_switch_pending': {
        showSharePlayActionToast('🎞', `已经问 TA 了 · TA 点好就换成《${String(msg.name || '').replace(/\.(mp4|mov|m4v|webm|mkv)$/i, '')}》`, { durationMs: 4000 });
        break;
      }
      case 'queue_switch_declined': {
        showSharePlayActionToast('⏸', QUEUE_COPY.declined, { durationMs: 3600 });
        break;
      }
      case 'queue_switched': {
        applyQueueSwitch(msg);
        break;
      }
      case 'peer_versions': {
        let peerVer = null;
        for (const [id, v] of Object.entries(msg.versions || {})) {
          if (id !== state.clientId) peerVer = v;
        }
        state.versionInfo.peerVersion = peerVer;
        if (msg.web) state.versionInfo.server = msg.web;
        updateVersionNotice();
        break;
      }
      default:
        break;
    }
  }

  function compareVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function updateVersionNotice() {
    if (!versionNotice) return;
    const v = state.versionInfo;
    let text = '';
    if (v.server && compareVersion(v.server, WEB_VERSION) > 0) text = QUEUE_COPY.older;
    else if (v.peerVersion && compareVersion(v.peerVersion, WEB_VERSION) < 0) text = QUEUE_COPY.peerOlder;
    versionNotice.textContent = text;
    versionNotice.classList.toggle('hidden', !text);
  }

  async function checkServerVersion() {
    try {
      const r = await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' });
      const j = await r.json();
      if (j && j.web) {
        state.versionInfo.server = j.web;
        state.versionInfo.buildTime = j.buildTime;
        updateVersionNotice();
      }
    } catch {}
  }

  function initVersionTags() {
    const fmt = (() => {
      try {
        const d = new Date(APP_BUILD_TIME_ISO);
        if (isNaN(d.getTime())) return APP_BUILD_TIME_ISO;
        const p = (n) => String(n).padStart(2, '0');
        const tz = new Date(d.getTime() + 9 * 3600 * 1000);
        return `${tz.getUTCFullYear()}-${p(tz.getUTCMonth() + 1)}-${p(tz.getUTCDate())} ${p(tz.getUTCHours())}:${p(tz.getUTCMinutes())}（东京时间）`;
      } catch { return ''; }
    })();
    document.querySelectorAll('[data-version-tag]').forEach((el) => {
      el.textContent = `v${WEB_VERSION} · ${APP_RELEASE_LABEL}`;
      el.title = `v${WEB_VERSION} · 更新于 ${fmt}`;
    });
  }
  const APP_RELEASE_LABEL = '10-27';
  const APP_BUILD_TIME_ISO = '2026-10-27T04:26:43.000Z';

  // ---------- 后台装入（只在轮到它、正在放的那部不卡的时候装）----------
  function stopBackgroundUpload() {
    const bg = state.bgUpload;
    state.bgUpload = null;
    if (bg) { try { bg.stop(); } catch {} }
  }

  function reconcileBackgroundUpload() {
    const q = state.queue;
    const turn = q.uploadTurn;
    const it = (q.items || []).find((x) => x.id === turn);
    const should = it && it.ownerKey === state.peerKey && it.id !== q.nowPlayingId && !it.ready && state.queueFiles.has(it.id);
    if (!should) {
      if (state.bgUpload) stopBackgroundUpload();
      return;
    }
    if (state.bgUpload && state.bgUpload.itemId === it.id) return;
    stopBackgroundUpload();
    startBackgroundUpload(it, state.queueFiles.get(it.id));
  }

  function startBackgroundUpload(item, file) {
    const engine = {
      itemId: item.id,
      stopped: false,
      inflight: new Map(),
      stop() {
        this.stopped = true;
        for (const e of this.inflight.values()) { try { e.xhr.abort(); } catch {} }
      }
    };
    state.bgUpload = engine;
    const alive = () => !engine.stopped && state.bgUpload === engine && Boolean(state.roomCode);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // 正在放的那部卡住了（我或 TA 在等画面、正在对齐进度）就先让路
    const yieldToPlaying = () => Boolean(
      state.isLocalBuffering || state.isPeerBuffering || state.activeSeek ||
      (state.queue.uploadTurn !== item.id)
    );
    (async () => {
      const edgeOk = (typeof item.edge === 'boolean') ? item.edge : await probeEdgeR2Available();
      if (!alive()) return;
      if (!edgeOk) { engine.edgeUnavailable = true; return; } // 没有边缘通道时：等轮到放这部时再装
      const total = file.size;
      const CH = item.chunkSize > 0 && item.edge === true ? item.chunkSize : 4 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(total / CH));
      const chunkLen = (i) => Math.min(total, (i + 1) * CH) - i * CH;
      const mime = file.type || 'video/mp4';
      const room = state.roomCode;
      const [moovRange, headFlag] = await Promise.all([findMp4MoovRange(file), detectMp4HeadMoov(file)]);
      let duration = Number(item.duration) || 0;
      if (!(duration > 0)) { try { duration = await readLocalFilmDuration(file); } catch {} }
      if (!alive()) return;
      const hasHeadMoov = moovRange ? moovRange.start < CH : headFlag;
      const indexRange = moovRange || (hasHeadMoov ? { start: 0, end: Math.min(total, 64 * 1024) } : { start: Math.max(0, total - 8 * 1024 * 1024), end: total });
      const clampIdx = (i) => Math.max(0, Math.min(totalChunks - 1, i));
      const indexChunks = [];
      for (let i = clampIdx(Math.floor(indexRange.start / CH)); i <= clampIdx(Math.floor(Math.max(0, indexRange.end - 1) / CH)); i++) indexChunks.push(i);
      const startBytes = computeStartBytes(total, duration);
      const streamUrl = `${EDGE_R2_BASE}/api/edge-film?room=${encodeURIComponent(room)}&uploadId=${encodeURIComponent(item.id)}&partSize=${CH}&total=${total}&type=${encodeURIComponent(mime)}`;
      const done = new Set();
      try {
        const res = await fetch(`${EDGE_R2_BASE}/api/edge-parts?room=${encodeURIComponent(room)}&uploadId=${encodeURIComponent(item.id)}`, { cache: 'no-store' });
        const j = await res.json();
        if (Array.isArray(j.parts)) j.parts.forEach((idx, k) => { if (idx >= 0 && idx < totalChunks && (!Array.isArray(j.sizes) || Number(j.sizes[k]) === chunkLen(idx))) done.add(idx); });
      } catch {}
      if (!alive()) return;
      const order = [...indexChunks];
      for (let i = 0; i < totalChunks; i++) if (!order.includes(i)) order.push(i);
      const partial = new Map();
      let lastSent = 0;
      const report = (force) => {
        const now = Date.now();
        if (!force && now - lastSent < 500) return;
        lastSent = now;
        let bytes = 0;
        for (const i of done) bytes += chunkLen(i);
        for (const v of partial.values()) bytes += v;
        let c = 0;
        while (c < totalChunks && done.has(c)) c++;
        const contig = Math.min(total, c * CH);
        const allDone = done.size >= totalChunks;
        const streamReady = allDone || (indexChunks.every((i) => done.has(i)) && contig >= startBytes);
        const pct = allDone ? 100 : Math.min(99, Math.floor((Math.min(total, bytes) / total) * 100));
        const local = (state.queue.items || []).find((x) => x.id === item.id);
        if (local) { local.pct = Math.max(local.pct || 0, pct); if (streamReady) local.streamReady = true; if (allDone) local.ready = true; renderQueue(); }
        sendSignal({ type: 'queue_progress', id: item.id, pct, contiguousBytes: contig, startBytes, duration, streamReady, ready: allDone, edgeStreamUrl: streamUrl, edge: true, chunkSize: CH });
      };
      const failCount = new Map();
      const sendOne = (idx) => new Promise((resolve) => {
        const start = idx * CH;
        const xhr = new XMLHttpRequest();
        const entry = { xhr };
        engine.inflight.set(idx, entry);
        const fin = (ok) => { engine.inflight.delete(idx); partial.delete(idx); resolve(ok); };
        xhr.open('PUT', `${EDGE_R2_BASE}/api/edge-film?room=${encodeURIComponent(room)}&uploadId=${encodeURIComponent(item.id)}&offset=${start}&partSize=${CH}&total=${total}&type=${encodeURIComponent(mime)}`, true);
        xhr.timeout = 90000;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { partial.set(idx, e.loaded); report(false); } };
        xhr.onload = () => fin(xhr.status >= 200 && xhr.status < 300);
        xhr.onerror = () => fin(false);
        xhr.ontimeout = () => fin(false);
        xhr.onabort = () => fin(false);
        try { xhr.send(file.slice(start, Math.min(total, start + CH))); } catch { fin(false); }
      });
      let ptr = 0;
      const nextIdx = () => {
        while (ptr < order.length && (done.has(order[ptr]) || engine.inflight.has(order[ptr]))) ptr++;
        if (ptr < order.length) return order[ptr];
        for (const i of order) if (!done.has(i) && !engine.inflight.has(i)) return i;
        return -1;
      };
      report(true);
      const worker = async () => {
        while (alive() && done.size < totalChunks) {
          if (yieldToPlaying()) { await sleep(600); continue; }
          const idx = nextIdx();
          if (idx < 0) { await sleep(400); continue; }
          const ok = await sendOne(idx);
          if (!alive()) return;
          if (ok) { done.add(idx); failCount.delete(idx); report(true); }
          else {
            const n = (failCount.get(idx) || 0) + 1;
            failCount.set(idx, n);
            await sleep(Math.min(10000, 1000 * Math.pow(2, n - 1)));
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      if (alive() && done.size >= totalChunks) {
        report(true);
        if (state.bgUpload === engine) state.bgUpload = null;
      }
    })().catch((e) => console.warn('[upload] background', e));
  }

  // 放这部时：服务端记住的上次位置 → 片源一就绪就跳过去
  mainMovieVideo.addEventListener('loadedmetadata', () => {
    const r = state.pendingQueueResume;
    if (!r) return;
    const d = mainMovieVideo.duration;
    if (r.duration > 0 && isFinite(d) && d > 0 && Math.abs(d - r.duration) > 3) return;
    state.pendingQueueResume = null;
    if (r.time > 0.5) {
      state.suppressSyncEmit = true;
      try { mainMovieVideo.currentTime = r.time; } catch {}
      setTimeout(() => { state.suppressSyncEmit = false; }, 200);
    }
  });

  function initQueueUI() {
    initVersionTags();
    renderQueue();
    if (queueToggleBtn) {
      queueToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setQueuePanelOpen(!isQueuePanelOpen());
      });
    }
    if (queueCloseBtn) queueCloseBtn.addEventListener('click', () => setQueuePanelOpen(false));
    if (queueGrab) queueGrab.addEventListener('click', () => setQueuePanelOpen(false));
    if (queuePanel) queuePanel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
      // 手机上点抽屉外面收起；桌面抽屉不挡画面，保持打开
      if (!isQueuePanelOpen() || window.matchMedia('(min-width: 960px)').matches) return;
      if (queuePanel.contains(e.target) || (queueToggleBtn && queueToggleBtn.contains(e.target))) return;
      if (queueAsk && queueAsk.contains(e.target)) return;
      setQueuePanelOpen(false);
    });
    if (queueAddBtn) {
      queueAddBtn.addEventListener('click', () => {
        if ((state.queue.items || []).length >= QUEUE_MAX_ITEMS) {
          showQueueCaption(QUEUE_COPY.full);
          return;
        }
        if (queueFileInput) queueFileInput.click();
      });
    }
    if (queueFileInput) {
      queueFileInput.addEventListener('change', () => {
        const f = queueFileInput.files && queueFileInput.files[0];
        queueFileInput.value = '';
        if (f) addFilmToQueue(f);
      });
    }
    if (queueAskOk) queueAskOk.addEventListener('click', () => {
      const id = state.queueAskId;
      closeQueueAsk();
      if (id) sendSignal({ type: 'queue_switch_reply', id, accept: true });
    });
    if (queueAskLater) queueAskLater.addEventListener('click', () => {
      const id = state.queueAskId;
      closeQueueAsk();
      if (id) sendSignal({ type: 'queue_switch_reply', id, accept: false });
    });
    checkServerVersion();
    setInterval(checkServerVersion, 5 * 60 * 1000);
  }

  // 10. UI 事件绑定
  function initUIEvents() {
    updateDuckingSwitchUI();

    selectVideoCreateBtn.addEventListener('click', () => {
      localVideoFileInput.click();
    });

    initQueueUI();

    const otherWaysLink = document.getElementById('otherWaysLink');
    if (otherWaysLink && guestQuickMatchBtn) {
      otherWaysLink.addEventListener('click', (e) => {
        e.stopPropagation();
        state.otherWaysOpen = true;
        otherWaysLink.classList.add('hidden');
        otherWaysLink.setAttribute('aria-expanded', 'true');
        guestQuickMatchBtn.classList.remove('hidden');
      });
    }

    const handlePickedFilm = (file) => {
      if (!state.roomCode && file && file.size > QUEUE_MAX_FILM_BYTES) {
        showSharePlayActionToast('ⓘ', QUEUE_COPY.tooBig, { durationMs: 3600 });
        return;
      }
      if (state.roomCode) {
        // 0) 本场待放映里已有我加入的这一部（例如刷新后重新选片）
        const queued = findMyQueueItemForFile(file);
        if (queued) {
          registerQueueFile(queued.id, file);
          if (queued.id !== state.queue.nowPlayingId) {
            showSharePlayActionToast('↻', '这部已经在待放映里了', { durationMs: 2600 });
            setQueuePanelOpen(true);
            return;
          }
          if (!(state.myUploadId === queued.id && state.uploadEngine)) {
            const rec0 = loadResumeRecord(state.roomCode);
            if (!(rec0 && rec0.uploadId === queued.id && fileMatchesUploadRecord(file, rec0))) {
              const resume = { uploadId: queued.id };
              if (typeof queued.edge === 'boolean') resume.edge = queued.edge;
              if (queued.chunkSize > 0) resume.chunkSize = queued.chunkSize;
              saveResumeRecord(Object.assign({ room: state.roomCode, name: file.name, size: file.size, lastModified: file.lastModified || 0, ts: Date.now() }, resume));
            }
          }
        } else {
          const roomSame = Boolean(state.fileMeta && !state.fileMeta.isDemo && state.fileMeta.name === file.name && Number(state.fileMeta.size) === Number(file.size));
          if (!roomSame) {
            const err = checkQueueLimits(file);
            if (err) {
              showSharePlayActionToast('ⓘ', err, { durationMs: 3600 });
              if (err === QUEUE_COPY.full) setQueuePanelOpen(true);
              return;
            }
          }
        }
        // 1) 正在装的就是这一部：接着装，什么都不重来
        if (state.myUploadId && state.uploadEngine && fileMatchesUploadRecord(file, state.myUploadInfo)) {
          const pctNow = Math.max(0, Math.min(100, Math.round(state.filmTransfer.pct || 0)));
          showSharePlayActionToast('↻', state.filmTransfer.ready ? '这部影片已经装好了' : `这部影片之前装到了 ${pctNow}%，接着装`, { durationMs: 3000 });
          return;
        }
        // 2) 之前装过一部分（例如刷新了页面）：复用原来的 uploadId，跳过已经装好的部分
        const rec = loadResumeRecord(state.roomCode);
        const roomFilmSame = Boolean(
          state.fileMeta && !state.fileMeta.isDemo &&
          state.fileMeta.name === file.name && Number(state.fileMeta.size) === Number(file.size)
        );
        if (rec && fileMatchesUploadRecord(file, rec) && (roomFilmSame || !state.fileMeta || state.currentUploadId === rec.uploadId)) {
          const keepTime = (state.peerPlayback && state.peerPlayback.currentTime) || 0;
          state.selectedFile = file;
          state.sameFileMatched = false;
          state.fileMeta = { name: file.name, size: file.size, type: file.type || 'video/mp4', isDemo: false };
          currentFileName.textContent = file.name;
          if (curtainFilmTitle) curtainFilmTitle.textContent = file.name;
          mainMovieVideo.removeAttribute('data-stream-url');
          mainMovieVideo.src = URL.createObjectURL(file);
          if (keepTime > 0) {
            mainMovieVideo.addEventListener('loadedmetadata', () => {
              try { mainMovieVideo.currentTime = keepTime; } catch {}
            }, { once: true });
          }
          markLocalFilmReady(true);
          sendSignal({
            type: 'file_meta',
            fileMeta: state.fileMeta,
            filmReady: true,
            isNewSelection: true,
            resumeUploadId: rec.uploadId
          });
          uploadHostFilmToRoom(file, true, rec);
          return;
        }
        // 3) 正在装另一部片时换片：先确认
        if (state.myUploadId && state.uploadEngine && state.filmTransfer.active && !state.filmTransfer.ready && state.peerCount >= 2 && !state.switchFilmConfirmed) {
          openSwitchFilmConfirm(file);
          return;
        }
        state.switchFilmConfirmed = false;

        const hostHasValidFilm = Boolean(state.filmTransfer.active || state.filmTransfer.ready || state.peerFilmReady);
        const isMatchingExistingHostFile =
          state.role !== 'host' &&
          hostHasValidFilm &&
          state.fileMeta &&
          state.fileMeta.name === file.name &&
          Number(state.fileMeta.size) === Number(file.size);

        state.selectedFile = file;
        state.fileMeta = {
          name: file.name,
          size: file.size,
          type: file.type || 'video/mp4',
          isDemo: false
        };
        currentFileName.textContent = file.name;
        if (curtainFilmTitle) curtainFilmTitle.textContent = file.name;
        mainMovieVideo.removeAttribute('data-stream-url');
        mainMovieVideo.src = URL.createObjectURL(file);
        mainMovieVideo.pause();
        mainMovieVideo.currentTime = 0;
        updatePlayButtonUI(false);
        setCurtainVisible(true);
        markLocalFilmReady(true);

        sendSignal({
          type: 'file_meta',
          fileMeta: state.fileMeta,
          filmReady: true,
          isNewSelection: !isMatchingExistingHostFile
        });

        if (!isMatchingExistingHostFile) {
          state.sameFileMatched = false;
          state.instantSyncOverride = false;
          uploadHostFilmToRoom(file, true);
        }
      } else {
        enterScreeningRoom({ mode: 'create', file, roomCode: '' });
      }
    };

    const openSwitchFilmConfirm = (file) => {
      if (!switchFilmConfirm) {
        state.switchFilmConfirmed = true;
        handlePickedFilm(file);
        return;
      }
      state.pendingSwitchFile = file;
      switchFilmConfirm.classList.remove('hidden');
      if (switchFilmConfirmCancel) switchFilmConfirmCancel.focus();
    };
    const closeSwitchFilmConfirm = () => {
      if (switchFilmConfirm) switchFilmConfirm.classList.add('hidden');
      state.pendingSwitchFile = null;
    };
    if (switchFilmConfirmOk) {
      switchFilmConfirmOk.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = state.pendingSwitchFile;
        closeSwitchFilmConfirm();
        if (f) {
          state.switchFilmConfirmed = true;
          handlePickedFilm(f);
        }
      });
    }
    if (switchFilmConfirmCancel) {
      switchFilmConfirmCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSwitchFilmConfirm();
      });
    }
    if (switchFilmConfirm) {
      switchFilmConfirm.addEventListener('click', (e) => {
        if (e.target === switchFilmConfirm) closeSwitchFilmConfirm();
      });
    }

    localVideoFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      // 清空 input，保证重新选同一个文件也能触发 change（用于续传）
      try { e.target.value = ''; } catch {}
      if (!file) return;
      handlePickedFilm(file);
    });

    quickDemoRoomBtn.addEventListener('click', () => {
      enterScreeningRoom({ mode: 'create', file: null, roomCode: '', isDemo: true });
    });

    joinRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = (roomCodeInput.value || '').trim().toUpperCase();
      if (!code || code.length < 4) {
        roomCodeInput.focus();
        return;
      }
      enterScreeningRoom({ mode: 'join', file: null, roomCode: code });
    });

    copyInviteLinkBtn.addEventListener('click', async () => {
      const code = state.roomCode || '3G6H';
      const inviteUrl = `${window.location.origin}/?room=${code}`;
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {}
      copyInviteText.textContent = '已复制入场券链接';
      setTimeout(() => {
        copyInviteText.textContent = '复制入场券链接';
      }, 2200);
    });

    if (duckToggleBtn) {
      duckToggleBtn.addEventListener('click', () => {
        toggleDuckingEnabled();
      });
    }

    if (drawerDuckSwitchBtn) {
      drawerDuckSwitchBtn.addEventListener('click', () => {
        toggleDuckingEnabled();
      });
    }

    toggleMicBtn.addEventListener('click', () => {
      state.micEnabled = !state.micEnabled;
      if (state.localStream) {
        state.localStream.getAudioTracks().forEach((t) => { t.enabled = state.micEnabled; });
      }
      toggleMicBtn.classList.toggle('active-gold', !state.micEnabled);
      localCamFacingTag.textContent = state.micEnabled ? '' : '我 · 麦克风已静默';
    });

    openSettingsDrawerBtn.addEventListener('click', () => {
      settingsDrawerBackdrop.classList.remove('hidden');
    });

    closeSettingsDrawerBtn.addEventListener('click', () => {
      settingsDrawerBackdrop.classList.add('hidden');
    });

    settingsDrawerBackdrop.addEventListener('click', (e) => {
      if (e.target === settingsDrawerBackdrop) {
        settingsDrawerBackdrop.classList.add('hidden');
      }
    });

    if (simulateSpeakBtn) simulateSpeakBtn.addEventListener('click', () => {
      state.simulatedSpeaking = !state.simulatedSpeaking;
      if (state.simulatedSpeaking) {
        state.lastVoiceTimestamp = Date.now() + 60000;
        setDuckingActive(true, 'remote');
        sendSignal({ type: 'peer_speaking', speaking: true });
        simulateSpeakBtn.textContent = '停止模拟说话';
      } else {
        state.lastVoiceTimestamp = Date.now() - 2000;
        setDuckingActive(false);
        simulateSpeakBtn.textContent = '模拟说话压音测试';
      }
      settingsDrawerBackdrop.classList.add('hidden');
    });

    flipCamBtn.addEventListener('click', async () => {
      state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
      if (state.localStream) {
        state.localStream.getTracks().forEach((t) => t.stop());
      }
      await initLocalMediaCamera();
      settingsDrawerBackdrop.classList.add('hidden');
    });

    leaveRoomBtn.addEventListener('click', () => {
      window.location.href = '/';
    });

    window.__loamlyWatch = {
      state,
      enterScreeningRoom,
      setDuckingActive,
      setCurtainVisible,
      updateSliderProgressTrack,
      updatePlayButtonUI,
      updateCurtainAndReadinessUI,
      handleSignalingMessage,
      toggleMovieMute,
      togglePeerMute
    };
  }

  checkWeChatBrowser();
  initUIEvents();
  bindMovieVideoEvents();
  initMixer();
  initTimelineHover();
  setupDesktopBoothDrag();
  startAudioDuckingLoop();

  const urlParams = new URLSearchParams(window.location.search);
  const initialRoom = urlParams.get('room');
  if (initialRoom && initialRoom.trim().length >= 4) {
    enterScreeningRoom({
      mode: 'join',
      file: null,
      roomCode: initialRoom.trim().toUpperCase()
    });
  } else {
    connectWebSocket();
  }
})();

/* ===== 控制坞自动隐藏（规则见设计规格）===== */
(function setupDockAutoHide() {
  const room = document.getElementById('roomView');
  const video = document.getElementById('mainMovieVideo');
  const stage = document.getElementById('theaterStage');
  const dockWrap = document.querySelector('.floating-glass-dock-wrap');
  const mixer = document.getElementById('volumeMixerPopover');
  const pauseOverlay = document.getElementById('screenPauseOverlay');
  const toast = document.getElementById('duckingStatusToast');
  if (!room || !video || !dockWrap) return;
  const MOUSE_IDLE_MS = 2500, TOUCH_IDLE_MS = 3000, KEY_IDLE_MS = 2000;
  const isTouch = window.matchMedia('(hover: none)').matches;
  let timer = null, hoveringDock = false;
  const st = () => window.__watchState || {};
  const mustStayVisible = () => {
    const s = st();
    return video.paused || !s.hasStartedScreening || s.isDraggingTimeline || s.activeSeek ||
      hoveringDock || (mixer && !mixer.classList.contains('hidden')) ||
      (pauseOverlay && !pauseOverlay.classList.contains('hidden')) ||
      (toast && toast.classList.contains('is-action-toast') && !toast.classList.contains('silent'));
  };
  const hide = () => {
    clearTimeout(timer);
    if (mustStayVisible()) { schedule(MOUSE_IDLE_MS); return; }
    room.classList.add('controls-idle');
  };
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(hide, ms); };
  const show = (ms) => { room.classList.remove('controls-idle'); schedule(ms || MOUSE_IDLE_MS); };
  const isIdle = () => room.classList.contains('controls-idle');

  if (!isTouch) {
    document.addEventListener('mousemove', () => show(MOUSE_IDLE_MS), { passive: true });
    document.addEventListener('wheel', () => show(MOUSE_IDLE_MS), { passive: true });
    if (stage) stage.addEventListener('mouseleave', (e) => {
      if (!dockWrap.contains(e.relatedTarget)) schedule(300);
    });
  }
  document.addEventListener('keydown', () => show(KEY_IDLE_MS));
  dockWrap.addEventListener('mouseenter', () => { hoveringDock = true; show(); });
  dockWrap.addEventListener('mouseleave', () => { hoveringDock = false; show(); });
  dockWrap.addEventListener('pointerdown', () => show(TOUCH_IDLE_MS), { passive: true });
  // 手机：点银幕切换显示/收起，3 秒后自动收起
  if (stage) stage.addEventListener('click', (e) => {
    if (!isTouch || e.target.closest('button, input, .floating-glass-dock-wrap')) return;
    if (isIdle()) show(TOUCH_IDLE_MS); else hide();
  });
  video.addEventListener('pause', () => show());
  video.addEventListener('play', () => show());
  show();
})();
