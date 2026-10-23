/**
 * Loamly 私人放映厅 · 异地连麦同步播放器 (watch.loamly.cn)
 * Apple TV+ / MUBI / A24 高定私人放映厅交互与底层 WebRTC P2P 引擎
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

  const theaterStage = document.getElementById('theaterStage');
  const mainMovieVideo = document.getElementById('mainMovieVideo');
  const startScreeningOverlay = document.getElementById('startScreeningOverlay');
  const curtainStatusBadge = document.getElementById('curtainStatusBadge');
  const curtainFilmTitle = document.getElementById('curtainFilmTitle');
  const curtainSubtext = document.getElementById('curtainSubtext');
  const startScreeningBtn = document.getElementById('startScreeningBtn');
  const startScreeningBtnText = document.getElementById('startScreeningBtnText');

  const duckingStatusToast = document.getElementById('duckingStatusToast');
  const duckingToastText = document.getElementById('duckingToastText');
  const voiceWaveBars = document.getElementById('voiceWaveBars');

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
  const toggleMicBtn = document.getElementById('toggleMicBtn');
  const switchFileBtn = document.getElementById('switchFileBtn');

  // 抽屉内底层状态与控制元素
  const currentFileName = document.getElementById('currentFileName');
  const p2pProgressText = document.getElementById('p2pProgressText');
  const movieVolumeText = document.getElementById('movieVolumeText');
  const wakeLockText = document.getElementById('wakeLockText');
  const playbackRateSelect = document.getElementById('playbackRateSelect');
  const simulateSpeakBtn = document.getElementById('simulateSpeakBtn');
  const flipCamBtn = document.getElementById('flipCamBtn');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  const savedDuckPref = localStorage.getItem('loamly_ducking_enabled');

  const state = {
    ws: null,
    wsConnected: false,
    roomCode: null,
    clientId: null,
    role: 'host',
    peerCount: 1,
    selectedFile: null,
    fileMeta: null,
    sameFileMatched: false,
    pc: null,
    pendingIceCandidates: [],
    makingOffer: false,
    fileChannel: null,
    localStream: null,
    localCameraPromise: null,
    remoteStream: null,
    micEnabled: true,
    camEnabled: true,
    facingMode: 'user',
    wakeLockSentinel: null,
    duckingEnabled: savedDuckPref !== '0',
    isSpeaking: false,
    simulatedSpeaking: false,
    lastVoiceTimestamp: 0,
    currentVolume: 1.0,
    targetVolume: 1.0,
    audioCtx: null,
    localAnalyser: null,
    remoteAnalyser: null,
    suppressSyncEmit: false,
    hasStartedScreening: false,
    receivingMeta: null,
    receivingChunks: [],
    receivedBytes: 0,
    receiveStartTime: 0,
    mediaSource: null,
    sourceBuffer: null,
    mseQueue: []
  };

  function updateSliderProgressTrack(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    timelineSlider.style.background = `linear-gradient(90deg, #D6B485 ${clamped}%, rgba(255, 255, 255, 0.16) ${clamped}%)`;
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

  function updateRoomPeerStatusUI() {
    if (state.peerCount >= 2) {
      if (curtainStatusBadge) {
        curtainStatusBadge.textContent = `NO. ${state.roomCode || '3G6H'} · 伴侣已落座 (2/2)`;
      }
      if (curtainSubtext) {
        curtainSubtext.textContent = '双人端到端连麦已就绪，点击下方按钮双方银幕将同步开映';
      }
      if (!state.isSpeaking) {
        pipPeerLabel.textContent = 'TA · 包厢已连麦';
      }
      if (p2pProgressText.textContent === '等待伴侣入座') {
        p2pProgressText.textContent = '双人端到端已直连';
      }
    } else {
      if (curtainStatusBadge) {
        curtainStatusBadge.textContent = `NO. ${state.roomCode || '3G6H'} · 等待开映`;
      }
      if (curtainSubtext) {
        curtainSubtext.textContent = '可复制右上角入场券邀伴侣入座，或直接点击下方按钮开映';
      }
      if (!state.isSpeaking) {
        pipPeerLabel.textContent = 'TA · 等待凭码入座';
      }
    }
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
              fileMeta: state.fileMeta
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

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${mb.toFixed(1)} MB`;
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
      case 'room_joined': {
        state.roomCode = msg.roomCode;
        state.clientId = msg.clientId;
        state.role = msg.role;
        state.peerCount = msg.peerCount || 1;
        roomCodeBadge.textContent = `NO. ${msg.roomCode}`;

        const newUrl = `${window.location.pathname}?room=${msg.roomCode}`;
        window.history.replaceState({ roomCode: msg.roomCode }, '', newUrl);

        if (msg.fileMeta && !state.selectedFile) {
          state.fileMeta = msg.fileMeta;
          currentFileName.textContent = msg.fileMeta.name;
          if (curtainFilmTitle) curtainFilmTitle.textContent = msg.fileMeta.name;
        }
        updateRoomPeerStatusUI();

        if (msg.playback && msg.playback.playing) {
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
        updateRoomPeerStatusUI();
        if (state.fileMeta) {
          sendSignal({
            type: 'file_meta',
            fileMeta: state.fileMeta
          });
        }
        await startWebRTCPeerConnection(true);
        break;
      }

      case 'peer_left': {
        state.peerCount = msg.peerCount || 1;
        state.role = msg.role || state.role;
        remoteCamVideo.srcObject = null;
        remoteCamVideo.classList.add('hidden');
        remotePortraitImg.classList.remove('hidden');
        state.remoteStream = null;
        updateRoomPeerStatusUI();
        break;
      }

      case 'file_meta': {
        if (msg.sameFileMatched) {
          activateSameFileZeroTrafficMode(msg.fileMeta);
        } else if (msg.fileMeta && !state.selectedFile) {
          state.fileMeta = msg.fileMeta;
          currentFileName.textContent = msg.fileMeta.name;
          if (curtainFilmTitle) curtainFilmTitle.textContent = msg.fileMeta.name;
        }
        break;
      }

      case 'same_file_matched': {
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
              // 房主作为 impolite peer 忽略极小概率的并发重协商冲突
              return;
            }
            await state.pc.setLocalDescription({ type: 'rollback' });
          }

          await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          attachLocalTracksToPeerConnection(state.pc);
          await flushPendingIceCandidates();

          const answer = await state.pc.createAnswer();
          await state.pc.setLocalDescription(answer);
          state.hasCompletedInitialHandshake = true;

          sendSignal({
            type: 'webrtc_answer',
            sdp: state.pc.localDescription
          });

          // 若在握手期间摄像头刚刚完成授权且有新轨道尚未协商，补发一次重协商
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

      case 'peer_speaking': {
        if (msg.speaking) {
          state.lastVoiceTimestamp = Date.now();
          setDuckingActive(true, 'remote');
        }
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
    p2pProgressText.textContent = `同源本地影片 · 0 缓冲同步 (${formatBytes(meta?.size || 0)})`;
  }

  function attachLocalTracksToPeerConnection(pc) {
    if (!pc || !state.localStream) return false;
    let addedNewTrack = false;
    const senders = pc.getSenders ? pc.getSenders() : [];

    for (const track of state.localStream.getTracks()) {
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
    return addedNewTrack;
  }

  async function renegotiatePeerConnection() {
    if (!state.pc || state.makingOffer || state.pc.signalingState !== 'stable') return;
    try {
      state.makingOffer = true;
      const offer = await state.pc.createOffer();
      if (state.pc.signalingState !== 'stable') return;
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

  // 5. WebRTC P2P DataChannel 分片直传与双人视频连麦（仅传双方真人摄像头与麦克风，绝不混入电影轨道）
  async function startWebRTCPeerConnection(isInitiator) {
    if (state.pc) {
      try { state.pc.close(); } catch {}
      state.pendingIceCandidates = [];
    }
    state.hasCompletedInitialHandshake = false;
    state.remoteStream = null;

    // 在创建 state.pc 之前先快速等待本地摄像头就绪（最多 600ms），避免 initLocalMediaCamera 在建连中途抢发 offer
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

      // 确保移动端/桌面端浏览器立即渲染对方视频画面
      remoteCamVideo.play().catch(() => {
        remoteCamVideo.muted = true;
        remoteCamVideo.play().catch(() => {});
        const unmuteOnTap = () => {
          remoteCamVideo.muted = false;
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

  function setupFileDataChannel(dc, isSender) {
    state.fileChannel = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFER_THRESHOLD;

    dc.onopen = () => {
      if (isSender && state.selectedFile && !state.sameFileMatched) {
        streamFileOverDataChannel(state.selectedFile, dc);
      }
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const ctrl = JSON.parse(event.data);
          if (ctrl.type === 'file_header') {
            initIncomingFileStream(ctrl);
          } else if (ctrl.type === 'file_eof') {
            finalizeIncomingFileStream();
          }
        } catch {}
      } else if (event.data instanceof ArrayBuffer) {
        handleIncomingFileChunk(event.data);
      }
    };
  }

  async function streamFileOverDataChannel(file, dc) {
    if (!file || !dc || dc.readyState !== 'open') return;
    const totalSize = file.size;
    let offset = 0;

    dc.send(JSON.stringify({
      type: 'file_header',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'video/mp4'
    }));

    const pumpNextSlices = async () => {
      while (offset < totalSize && dc.readyState === 'open') {
        if (state.sameFileMatched) return;
        if (dc.bufferedAmount > BUFFER_THRESHOLD * 2) {
          dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            pumpNextSlices();
          };
          return;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buf = await slice.arrayBuffer();
        dc.send(buf);
        offset += buf.byteLength;

        const pct = Math.min(100, Math.round((offset / totalSize) * 100));
        p2pProgressText.textContent = `端到端片源同步 ${pct}%`;
      }

      if (offset >= totalSize && dc.readyState === 'open') {
        dc.send(JSON.stringify({ type: 'file_eof' }));
        p2pProgressText.textContent = `端到端片源已就绪 (${formatBytes(totalSize)})`;
      }
    };

    pumpNextSlices();
  }

  function initIncomingFileStream(header) {
    state.receivingMeta = header;
    state.receivingChunks = [];
    state.receivedBytes = 0;
    state.receiveStartTime = performance.now();
    currentFileName.textContent = header.name;
    if (curtainFilmTitle) curtainFilmTitle.textContent = header.name;

    const mseMime = header.mimeType && header.mimeType.includes('webm')
      ? 'video/webm; codecs="vp8, opus"'
      : 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

    if ('MediaSource' in window && MediaSource.isTypeSupported(mseMime)) {
      try {
        const ms = new MediaSource();
        state.mediaSource = ms;
        state.mseQueue = [];
        mainMovieVideo.src = URL.createObjectURL(ms);
        ms.addEventListener('sourceopen', () => {
          try {
            const sb = ms.addSourceBuffer(mseMime);
            state.sourceBuffer = sb;
            sb.addEventListener('updateend', () => {
              if (state.mseQueue.length > 0 && !sb.updating) {
                sb.appendBuffer(state.mseQueue.shift());
              }
            });
          } catch {
            state.sourceBuffer = null;
          }
        });
      } catch {
        state.mediaSource = null;
      }
    }
  }

  function handleIncomingFileChunk(arrayBuffer) {
    state.receivingChunks.push(arrayBuffer);
    state.receivedBytes += arrayBuffer.byteLength;

    if (state.sourceBuffer) {
      try {
        if (!state.sourceBuffer.updating && state.mseQueue.length === 0) {
          state.sourceBuffer.appendBuffer(arrayBuffer);
        } else {
          state.mseQueue.push(arrayBuffer);
        }
      } catch {
        state.sourceBuffer = null;
      }
    }

    const total = (state.receivingMeta && state.receivingMeta.size) || state.receivedBytes;
    const pct = Math.min(100, Math.round((state.receivedBytes / total) * 100));
    p2pProgressText.textContent = `正在同步片源 ${pct}%`;
  }

  function finalizeIncomingFileStream() {
    const mimeType = (state.receivingMeta && state.receivingMeta.mimeType) || 'video/mp4';
    const blob = new Blob(state.receivingChunks, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    if (!state.sourceBuffer || mainMovieVideo.error) {
      const prevTime = mainMovieVideo.currentTime || 0;
      mainMovieVideo.src = blobUrl;
      mainMovieVideo.currentTime = prevTime;
    }
    p2pProgressText.textContent = `片源同步完成 (${formatBytes(blob.size)})`;
  }

  // 6. 播放同步与校准
  function applyRemotePlaybackSync(msg) {
    state.suppressSyncEmit = true;
    try {
      if (typeof msg.playbackRate === 'number' && Math.abs(mainMovieVideo.playbackRate - msg.playbackRate) > 0.01) {
        mainMovieVideo.playbackRate = msg.playbackRate;
        playbackRateSelect.value = String(msg.playbackRate);
      }

      if (typeof msg.currentTime === 'number') {
        const netDelaySec = msg.sentAt ? Math.max(0, Math.min(0.4, (Date.now() - msg.sentAt) / 1000)) : 0;
        const expectedTime = msg.playing ? msg.currentTime + netDelaySec : msg.currentTime;
        const drift = Math.abs((mainMovieVideo.currentTime || 0) - expectedTime);

        if (msg.type === 'sync_seek' || drift > 0.5) {
          mainMovieVideo.currentTime = expectedTime;
        }
      }

      if (msg.type === 'sync_play' || (msg.type === 'sync_heartbeat' && msg.playing)) {
        setCurtainVisible(false);
        if (mainMovieVideo.paused) {
          mainMovieVideo.play().catch(() => {});
        }
        updatePlayButtonUI(true);
      } else if (msg.type === 'sync_pause' || (msg.type === 'sync_heartbeat' && msg.playing === false)) {
        if (!mainMovieVideo.paused) {
          mainMovieVideo.pause();
        }
        updatePlayButtonUI(false);
      }
    } finally {
      setTimeout(() => {
        state.suppressSyncEmit = false;
      }, 80);
    }
  }

  function updatePlayButtonUI(isPlaying) {
    if (isPlaying) {
      playPauseSvg.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect>';
    } else {
      playPauseSvg.innerHTML = '<polygon points="7 5 19 12 7 19 7 5"></polygon>';
    }
  }

  function triggerStartOrTogglePlayback() {
    ensureAudioContext();
    setCurtainVisible(false);
    if (mainMovieVideo.paused) {
      mainMovieVideo.play().catch(() => {});
    } else {
      mainMovieVideo.pause();
    }
  }

  function bindMovieVideoEvents() {
    mainMovieVideo.addEventListener('loadedmetadata', () => {
      const cur = mainMovieVideo.currentTime || 0;
      const dur = mainMovieVideo.duration || 8;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      timelineSlider.value = String(pct.toFixed(1));
      updateSliderProgressTrack(pct);
      timeReadout.textContent = `${formatCinemaTime(cur)} / ${formatCinemaTime(dur)}`;
    });

    mainMovieVideo.addEventListener('timeupdate', () => {
      const cur = mainMovieVideo.currentTime || 0;
      const dur = mainMovieVideo.duration || 8;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      timelineSlider.value = String(pct.toFixed(1));
      updateSliderProgressTrack(pct);
      timeReadout.textContent = `${formatCinemaTime(cur)} / ${formatCinemaTime(dur)}`;
    });

    mainMovieVideo.addEventListener('play', () => {
      setCurtainVisible(false);
      updatePlayButtonUI(true);
      if (!state.suppressSyncEmit) {
        sendSignal({
          type: 'sync_play',
          currentTime: mainMovieVideo.currentTime,
          playing: true,
          playbackRate: mainMovieVideo.playbackRate,
          sentAt: Date.now()
        });
      }
    });

    mainMovieVideo.addEventListener('pause', () => {
      updatePlayButtonUI(false);
      if (!state.suppressSyncEmit) {
        sendSignal({
          type: 'sync_pause',
          currentTime: mainMovieVideo.currentTime,
          playing: false,
          playbackRate: mainMovieVideo.playbackRate,
          sentAt: Date.now()
        });
      }
    });

    playPauseBtn.addEventListener('click', () => {
      triggerStartOrTogglePlayback();
    });

    if (startScreeningBtn) {
      startScreeningBtn.addEventListener('click', () => {
        ensureAudioContext();
        setCurtainVisible(false);
        mainMovieVideo.play().catch(() => {});
      });
    }

    timelineSlider.addEventListener('input', () => {
      const dur = mainMovieVideo.duration || 8;
      const pct = parseFloat(timelineSlider.value) || 0;
      const targetTime = (pct / 100) * dur;
      mainMovieVideo.currentTime = targetTime;
      updateSliderProgressTrack(pct);
      timeReadout.textContent = `${formatCinemaTime(targetTime)} / ${formatCinemaTime(dur)}`;
      sendSignal({
        type: 'sync_seek',
        currentTime: targetTime,
        playing: !mainMovieVideo.paused,
        sentAt: Date.now()
      });
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

    setInterval(() => {
      if (state.roomCode && !mainMovieVideo.paused) {
        sendSignal({
          type: 'sync_heartbeat',
          currentTime: mainMovieVideo.currentTime,
          playing: !mainMovieVideo.paused,
          playbackRate: mainMovieVideo.playbackRate,
          sentAt: Date.now()
        });
      }
    }, 2000);
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
      state.targetVolume = 1.0;
      duckingStatusToast.classList.add('silent');
      partnerSeatCard.classList.remove('is-speaking');
      selfSeatCard.classList.remove('is-speaking');
      if (seatPartnerWave) seatPartnerWave.classList.add('hidden');
      pipPeerLabel.textContent = state.peerCount >= 2 ? 'TA · 包厢已连麦' : 'TA · 等待凭码入座';
      movieVolumeText.textContent = '100% (说话自动压音已关闭)';
      return;
    }

    if (speaking) {
      state.targetVolume = DUCK_TARGET_VOLUME;
      duckingStatusToast.classList.remove('silent');
      if (speakerWho === 'local') {
        duckingToastText.textContent = '你正在说话 · 银幕音量已自动压低至 25%';
        selfSeatCard.classList.add('is-speaking');
      } else {
        duckingToastText.textContent = 'TA 正在轻声说话 · 银幕音量已缓缓轻落至 25%';
        partnerSeatCard.classList.add('is-speaking');
        if (seatPartnerWave) seatPartnerWave.classList.remove('hidden');
        pipPeerLabel.textContent = 'TA · 正在轻声说话';
      }
      movieVolumeText.textContent = '25% (说话时自动轻落)';
    } else {
      state.targetVolume = 1.0;
      duckingStatusToast.classList.add('silent');
      partnerSeatCard.classList.remove('is-speaking');
      selfSeatCard.classList.remove('is-speaking');
      if (seatPartnerWave) seatPartnerWave.classList.add('hidden');
      pipPeerLabel.textContent = state.peerCount >= 2 ? 'TA · 包厢已连麦' : 'TA · 等待凭码入座';
      movieVolumeText.textContent = '100% (银幕原声 · 说话自动压至 25%)';
    }
  }

  function toggleDuckingEnabled() {
    state.duckingEnabled = !state.duckingEnabled;
    localStorage.setItem('loamly_ducking_enabled', state.duckingEnabled ? '1' : '0');
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

  // 8. 本地摄像头采集与动态推流（若用户在 WebRTC 建连后才点“允许摄像头”，自动补推流并重协商）
  function initLocalMediaCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(null);
    }

    const videoConstraints = {
      facingMode: state.facingMode,
      width: { ideal: 480 },
      height: { ideal: 360 }
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
        // 若麦克风被占用或无麦克风，降级仅请求摄像头画面，确保能看到脸
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
      localCamFacingTag.textContent = state.micEnabled ? '我 · 包厢已连麦' : '我 · 麦克风已静默';
      setupAudioAnalyserForStream(stream, 'local');

      // 如果此时首轮 WebRTC 握手已完成，把新拿到的摄像头轨道动态挂载上去并触发二次协商
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

  // 9. 开启私人放映厅（默认暂停等待开映，点击「开始同步放映」后双端同步开场）
  async function enterScreeningRoom({ mode, file, roomCode }) {
    homeView.classList.add('hidden');
    lobbyEditionLabel.classList.add('hidden');
    roomView.classList.remove('hidden');
    roomHeaderActions.classList.remove('hidden');

    const preferredCode = (roomCode || '3G6H').trim().toUpperCase();
    state.roomCode = preferredCode;
    roomCodeBadge.textContent = `NO. ${preferredCode}`;

    if (file) {
      state.selectedFile = file;
      state.fileMeta = {
        name: file.name,
        size: file.size,
        type: file.type || 'video/mp4'
      };
      currentFileName.textContent = file.name;
      if (curtainFilmTitle) curtainFilmTitle.textContent = file.name;
      mainMovieVideo.src = URL.createObjectURL(file);
    } else {
      mainMovieVideo.src = '/demo-clip.mp4';
      currentFileName.textContent = '暮色山谷 · 试映短片';
      if (curtainFilmTitle) curtainFilmTitle.textContent = '暮色山谷 · 试映短片';
    }

    // 进房默认暂停在片头，等待双方点击「开始同步放映」
    mainMovieVideo.pause();
    mainMovieVideo.currentTime = 0;
    mainMovieVideo.volume = 1.0;
    state.currentVolume = 1.0;
    state.targetVolume = 1.0;
    state.simulatedSpeaking = false;
    state.hasStartedScreening = false;

    updatePlayButtonUI(false);
    updateSliderProgressTrack(0);
    setCurtainVisible(true);
    updateDuckingSwitchUI();
    setDuckingActive(false);
    updateRoomPeerStatusUI();

    requestScreenWakeLock();
    initLocalMediaCamera();

    connectWebSocket(() => {
      if (mode === 'create') {
        sendSignal({
          type: 'create_room',
          roomCode: preferredCode,
          fileMeta: state.fileMeta
        });
      } else {
        sendSignal({
          type: 'join_room',
          roomCode: preferredCode,
          fileMeta: state.fileMeta
        });
      }
    });
  }

  // 10. UI 事件绑定
  function initUIEvents() {
    updateDuckingSwitchUI();

    selectVideoCreateBtn.addEventListener('click', () => {
      localVideoFileInput.click();
    });

    switchFileBtn.addEventListener('click', () => {
      localVideoFileInput.click();
    });

    localVideoFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (state.roomCode) {
        state.selectedFile = file;
        state.sameFileMatched = false;
        state.fileMeta = {
          name: file.name,
          size: file.size,
          type: file.type || 'video/mp4'
        };
        currentFileName.textContent = file.name;
        if (curtainFilmTitle) curtainFilmTitle.textContent = file.name;
        mainMovieVideo.src = URL.createObjectURL(file);
        mainMovieVideo.pause();
        mainMovieVideo.currentTime = 0;
        updatePlayButtonUI(false);
        setCurtainVisible(true);

        sendSignal({
          type: 'file_meta',
          fileMeta: state.fileMeta
        });

        if (state.fileChannel && state.fileChannel.readyState === 'open') {
          streamFileOverDataChannel(file, state.fileChannel);
        }
      } else {
        enterScreeningRoom({ mode: 'create', file, roomCode: '3G6H' });
      }
    });

    quickDemoRoomBtn.addEventListener('click', async () => {
      try {
        const res = await fetch('/demo-clip.mp4');
        const blob = await res.blob();
        const demoFile = new File([blob], '暮色山谷_试映片段.mp4', { type: 'video/mp4' });
        enterScreeningRoom({ mode: 'create', file: demoFile, roomCode: '3G6H' });
      } catch {
        enterScreeningRoom({ mode: 'create', file: null, roomCode: '3G6H' });
      }
    });

    joinRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = (roomCodeInput.value || '').trim().toUpperCase() || '3G6H';
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

    duckToggleBtn.addEventListener('click', () => {
      toggleDuckingEnabled();
    });

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
      localCamFacingTag.textContent = state.micEnabled ? '我 · 包厢已连麦' : '我 · 麦克风已静默';
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

    simulateSpeakBtn.addEventListener('click', () => {
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
      updatePlayButtonUI
    };
  }

  checkWeChatBrowser();
  initUIEvents();
  bindMovieVideoEvents();
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
