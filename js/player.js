/* ============================================
   ZCut Pro - Player Module
   Preview Player, Canvas Renderer, Playback Controls
   ============================================ */

(function() {
    'use strict';
    const app = window.zcutApp;

    class Player {
        constructor() {
            this.canvas = document.getElementById('preview-canvas');
            this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
            this.viewport = document.getElementById('preview-viewport');
            this.isPlaying = false;
            this.isPaused = true;
            this.currentTime = 0;
            this.playbackSpeed = 1;
            this.volume = 1;
            this.isMuted = false;
            this.isLooping = false;
            this.isFullscreen = false;
            this.projectWidth = 1920;
            this.projectHeight = 1080;
            this.projectFps = 30;
            this.projectBg = '#000000';
            this._rafId = null;
            this._lastFrameTime = 0;
            this._videoElements = {};
            this._audioElements = {};
            this._showSafeZone = false;
            this._showGrid = false;
            this._init();
        }

        _init() {
            const initWhenReady = () => {
                if (!app || !app.projectManager) { setTimeout(initWhenReady, 100); return; }
                this._setupCanvas();
                this._bindEvents();
                this._renderBlankFrame();
            };
            if (document.readyState === 'complete') initWhenReady();
            else window.addEventListener('load', initWhenReady);
        }

        _setupCanvas() {
            if (!this.canvas) return;
            this._resizeCanvas();
            window.addEventListener('resize', () => this._resizeCanvas());
        }

        _resizeCanvas() {
            if (!this.canvas || !this.viewport) return;
            const vw = this.viewport.clientWidth;
            const vh = this.viewport.clientHeight;
            const project = app.projectManager.getProject();
            const pw = project?.resolution?.width || 1920;
            const ph = project?.resolution?.height || 1080;
            const ratio = pw / ph;
            let cw, ch;
            if (vw / vh > ratio) { ch = vh; cw = ch * ratio; }
            else { cw = vw; ch = cw / ratio; }
            this.canvas.style.width = cw + 'px';
            this.canvas.style.height = ch + 'px';
            this.canvas.width = cw * window.devicePixelRatio;
            this.canvas.height = ch * window.devicePixelRatio;
            this.projectWidth = pw;
            this.projectHeight = ph;
        }

        _bindEvents() {
            // Play/Pause
            const playBtn = document.getElementById('play-btn');
            if (playBtn) playBtn.addEventListener('click', () => this.togglePlay());
            // Frame navigation
            document.getElementById('prev-frame-btn')?.addEventListener('click', () => this.prevFrame());
            document.getElementById('next-frame-btn')?.addEventListener('click', () => this.nextFrame());
            document.getElementById('go-to-start-btn')?.addEventListener('click', () => this.goToStart());
            document.getElementById('go-to-end-btn')?.addEventListener('click', () => this.goToEnd());
            // Loop
            document.getElementById('loop-btn')?.addEventListener('click', (e) => {
                this.isLooping = !this.isLooping;
                e.currentTarget.classList.toggle('active', this.isLooping);
            });
            // Volume
            const volumeSlider = document.getElementById('volume-slider');
            if (volumeSlider) volumeSlider.addEventListener('input', (e) => {
                this.volume = parseInt(e.target.value) / 100;
                this._updateVolumeIcon();
                this._applyVolumeToAll();
            });
            document.getElementById('mute-btn')?.addEventListener('click', (e) => {
                this.isMuted = !this.isMuted;
                e.currentTarget.querySelector('i').className = this.isMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
                this._applyVolumeToAll();
            });
            // Playback speed
            const speedSelect = document.getElementById('playback-speed');
            if (speedSelect) speedSelect.addEventListener('change', (e) => {
                this.playbackSpeed = parseFloat(e.target.value);
            });
            // Safe zone
            document.getElementById('safe-zone-btn')?.addEventListener('click', () => {
                this._showSafeZone = !this._showSafeZone;
                const sz = document.getElementById('safe-zone');
                if (sz) sz.style.display = this._showSafeZone ? 'block' : 'none';
            });
            // Grid
            document.getElementById('grid-btn')?.addEventListener('click', () => {
                this._showGrid = !this._showGrid;
                const grid = document.getElementById('grid-overlay');
                if (grid) grid.style.display = this._showGrid ? 'block' : 'none';
            });
            // Snapshot
            document.getElementById('snapshot-btn')?.addEventListener('click', () => this.takeSnapshot());
            // Fullscreen
            document.getElementById('fullscreen-preview-btn')?.addEventListener('click', () => this.toggleFullscreen());
            document.getElementById('fullscreen-player-btn')?.addEventListener('click', () => this.toggleFullscreen());
            // Preview tabs
            document.querySelectorAll('.preview-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                });
            });
            // EventBus
            app.eventBus.on('player:toggle-play', () => this.togglePlay());
            app.eventBus.on('player:prev-frame', () => this.prevFrame());
            app.eventBus.on('player:next-frame', () => this.nextFrame());
            app.eventBus.on('player:go-to-start', () => this.goToStart());
            app.eventBus.on('player:go-to-end', () => this.goToEnd());
            app.eventBus.on('player:play-reverse', () => this.playReverse());
            app.eventBus.on('player:play-forward', () => this.playForward());
            app.eventBus.on('player:stop', () => this.stop());
            app.eventBus.on('player:seek', (time) => this.seek(time));
            app.eventBus.on('player:fullscreen', () => this.toggleFullscreen());
            app.eventBus.on('project:settings-changed', () => {
                const p = app.projectManager.getProject();
                if (p) {
                    this.projectWidth = p.resolution.width;
                    this.projectHeight = p.resolution.height;
                    this.projectFps = p.fps;
                    this.projectBg = p.backgroundColor;
                    this._resizeCanvas();
                    this.render();
                }
            });
        }

        togglePlay() {
            if (this.isPlaying) this.pause();
            else this.play();
        }

        play() {
            if (this.isPlaying) return;
            this.isPlaying = true;
            this.isPaused = false;
            this._lastFrameTime = performance.now();
            const playBtn = document.getElementById('play-btn');
            if (playBtn) playBtn.querySelector('i').className = 'fas fa-pause';
            app.stateManager.set('isPlaying', true);
            this._playbackLoop();
            this._resumeAllMedia();
        }

        pause() {
            this.isPlaying = false;
            this.isPaused = true;
            if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
            const playBtn = document.getElementById('play-btn');
            if (playBtn) playBtn.querySelector('i').className = 'fas fa-play';
            app.stateManager.set('isPlaying', false);
            this._pauseAllMedia();
        }

        stop() {
            this.pause();
            this.currentTime = 0;
            this.seek(0);
        }

        playForward() {
            this.playbackSpeed = Math.min(4, this.playbackSpeed + 0.5);
            const speedSel = document.getElementById('playback-speed');
            if (speedSel) speedSel.value = this.playbackSpeed;
            if (!this.isPlaying) this.play();
        }

        playReverse() {
            // Simplified reverse playback
            this.playbackSpeed = -1;
            if (!this.isPlaying) this.play();
        }

        prevFrame() {
            const fps = this.projectFps || 30;
            this.seek(Math.max(0, this.currentTime - 1 / fps));
        }

        nextFrame() {
            const fps = this.projectFps || 30;
            const duration = app.projectManager.calculateDuration() || 60;
            this.seek(Math.min(duration, this.currentTime + 1 / fps));
        }

        goToStart() { this.seek(0); }

        goToEnd() {
            const duration = app.projectManager.calculateDuration() || 60;
            this.seek(duration);
        }

        seek(time) {
            this.currentTime = Math.max(0, time);
            app.stateManager.set('currentTime', this.currentTime);
            app.stateManager.set('playheadPosition', this.currentTime);
            // Update playhead
            const playhead = document.getElementById('playhead');
            if (playhead && window.zcutTimeline) {
                const pps = window.zcutTimeline.pixelsPerSecond || 100;
                playhead.style.left = (this.currentTime * pps) + 'px';
            }
            // Update timecode
            const ctEl = document.getElementById('current-time');
            if (ctEl) ctEl.textContent = Utils.secondsToTimecode(this.currentTime, this.projectFps);
            // Seek media elements
            this._seekAllMedia(this.currentTime);
            // Render current frame
            this.render();
        }

        _playbackLoop() {
            if (!this.isPlaying) return;
            const now = performance.now();
            const delta = (now - this._lastFrameTime) / 1000;
            this._lastFrameTime = now;
            const duration = app.projectManager.calculateDuration() || 60;
            this.currentTime += delta * this.playbackSpeed;
            if (this.currentTime >= duration) {
                if (this.isLooping) { this.currentTime = 0; this._seekAllMedia(0); }
                else { this.currentTime = duration; this.pause(); return; }
            }
            if (this.currentTime < 0) {
                if (this.isLooping) this.currentTime = duration;
                else { this.currentTime = 0; this.pause(); return; }
            }
            // Update playhead
            app.stateManager.set('currentTime', this.currentTime);
            app.stateManager.set('playheadPosition', this.currentTime);
            const playhead = document.getElementById('playhead');
            if (playhead && window.zcutTimeline) {
                const pps = window.zcutTimeline.pixelsPerSecond || 100;
                playhead.style.left = (this.currentTime * pps) + 'px';
            }
            const ctEl = document.getElementById('current-time');
            if (ctEl) ctEl.textContent = Utils.secondsToTimecode(this.currentTime, this.projectFps);
            this.render();
            this._rafId = requestAnimationFrame(() => this._playbackLoop());
        }

        render() {
            if (!this.ctx || !this.canvas) return;
            const ctx = this.ctx;
            const cw = this.canvas.width;
            const ch = this.canvas.height;
            const dpr = window.devicePixelRatio;
            ctx.save();
            ctx.scale(dpr, dpr);
            const w = cw / dpr;
            const h = ch / dpr;
            // Clear
            ctx.fillStyle = this.projectBg || '#000000';
            ctx.fillRect(0, 0, w, h);
            // Get active clips at current time
            const project = app.projectManager.getProject();
            if (!project) { ctx.restore(); return; }
            const tracks = project.tracks || [];
            const time = this.currentTime;
            // Render tracks from bottom to top (last track = top layer)
            const videoTracks = tracks.filter(t => t.type === 'video' || t.type === 'text');
            videoTracks.forEach(track => {
                if (track.muted || !track.visible) return;
                const activeClips = track.clips.filter(c => time >= c.startTime && time < c.endTime);
                activeClips.forEach(clip => this._renderClip(ctx, clip, w, h, time));
            });
            ctx.restore();
            // Update audio meters
            this._updateAudioMeters();
            // Update memory in status bar
            const memEl = document.getElementById('status-memory');
            if (memEl) memEl.textContent = 'Memori: ' + Utils.getMemoryUsage() + ' MB';
        }

        _renderClip(ctx, clip, canvasW, canvasH, time) {
            const scaleX = canvasW / this.projectWidth;
            const scaleY = canvasH / this.projectHeight;
            ctx.save();
            // Apply clip transforms
            const px = clip.positionX * scaleX;
            const py = clip.positionY * scaleY;
            const scale = clip.scale / 100;
            const rotation = clip.rotation * Math.PI / 180;
            const opacity = clip.opacity / 100;
            ctx.globalAlpha = opacity;
            ctx.translate(canvasW / 2 + px, canvasH / 2 + py);
            ctx.rotate(rotation);
            ctx.scale(clip.flipH ? -scale : scale, clip.flipV ? -scale : scale);
            if (clip.type === 'video' || clip.type === 'image') {
                this._renderVideoClip(ctx, clip, canvasW, canvasH);
            } else if (clip.type === 'text') {
                this._renderTextClip(ctx, clip, canvasW, canvasH, time);
            } else if (clip.type === 'shape') {
                this._renderShapeClip(ctx, clip);
            } else if (clip.type === 'sticker') {
                this._renderStickerClip(ctx, clip);
            }
            // Apply effects
            this._applyClipEffects(ctx, clip);
            ctx.restore();
        }

        _renderVideoClip(ctx, clip, cw, ch) {
            let videoEl = this._videoElements[clip.id];
            if (clip.sourceUrl && clip.type === 'video') {
                if (!videoEl) {
                    videoEl = document.createElement('video');
                    videoEl.src = clip.sourceUrl;
                    videoEl.muted = true;
                    videoEl.preload = 'auto';
                    videoEl.playsInline = true;
                    this._videoElements[clip.id] = videoEl;
                    videoEl.addEventListener('loadeddata', () => {
                        videoEl.currentTime = clip.inPoint;
                    });
                }
                try {
                    const clipTime = this.currentTime - clip.startTime;
                    const sourceTime = clip.inPoint + clipTime * clip.speed;
                    if (Math.abs(videoEl.currentTime - sourceTime) > 0.1 && !this.isPlaying) {
                        videoEl.currentTime = sourceTime;
                    }
                    const vw = videoEl.videoWidth || cw;
                    const vh = videoEl.videoHeight || ch;
                    const drawW = cw;
                    const drawH = cw * (vh / vw);
                    ctx.drawImage(videoEl, -drawW / 2, -drawH / 2, drawW, drawH);
                } catch (e) {
                    this._renderPlaceholder(ctx, cw, ch, clip);
                }
            } else if (clip.type === 'image' && clip.sourceUrl) {
                let imgEl = this._videoElements[clip.id];
                if (!imgEl) {
                    imgEl = new Image();
                    imgEl.src = clip.sourceUrl;
                    this._videoElements[clip.id] = imgEl;
                }
                try {
                    if (imgEl.complete && imgEl.naturalWidth > 0) {
                        const drawW = cw;
                        const drawH = cw * (imgEl.naturalHeight / imgEl.naturalWidth);
                        ctx.drawImage(imgEl, -drawW / 2, -drawH / 2, drawW, drawH);
                    } else {
                        this._renderPlaceholder(ctx, cw, ch, clip);
                    }
                } catch(e) {
                    this._renderPlaceholder(ctx, cw, ch, clip);
                }
            } else {
                this._renderPlaceholder(ctx, cw, ch, clip);
            }
        }

        _renderPlaceholder(ctx, cw, ch, clip) {
            const w = cw * 0.8;
            const h = ch * 0.5;
            ctx.fillStyle = 'rgba(74,158,255,0.15)';
            Utils.drawRoundedRect(ctx, -w / 2, -h / 2, w, h, 8);
            ctx.fill();
            ctx.strokeStyle = 'rgba(74,158,255,0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = '#4a9eff';
            ctx.font = '14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(clip.name || 'Media', 0, 0);
        }

        _renderTextClip(ctx, clip, cw, ch, time) {
            const text = clip.text || 'Teks';
            ctx.font = `${clip.fontWeight || 400} ${clip.fontSize || 48}px ${clip.fontFamily || 'Inter'}`;
            ctx.textAlign = clip.textAlign || 'center';
            ctx.textBaseline = 'middle';
            // Background
            if (clip.textBgColor && clip.textBgColor !== 'transparent') {
                const metrics = ctx.measureText(text);
                const tw = metrics.width + 20;
                const th = (clip.fontSize || 48) * 1.4;
                ctx.fillStyle = clip.textBgColor;
                Utils.drawRoundedRect(ctx, -tw / 2, -th / 2, tw, th, 4);
                ctx.fill();
            }
            // Shadow
            if (clip.textShadow) {
                ctx.shadowColor = clip.textShadowColor || '#000000';
                ctx.shadowBlur = clip.textShadowBlur || 4;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
            }
            // Stroke
            if (clip.textStroke) {
                ctx.strokeStyle = clip.textStrokeColor || '#000000';
                ctx.lineWidth = clip.textStrokeWidth || 2;
                ctx.strokeText(text, 0, 0);
            }
            // Fill
            ctx.fillStyle = clip.fontColor || '#ffffff';
            ctx.fillText(text, 0, 0);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        _renderShapeClip(ctx, clip) {
            const shapes = {
                circle: () => { ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); },
                square: () => { ctx.fillRect(-35, -35, 70, 70); ctx.strokeRect(-35, -35, 70, 70); },
                triangle: () => { ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(35, 30); ctx.lineTo(-35, 30); ctx.closePath(); ctx.fill(); ctx.stroke(); },
                star: () => { this._drawStar(ctx, 0, 0, 5, 40, 20); ctx.fill(); ctx.stroke(); },
                heart: () => { this._drawHeart(ctx, 0, 0, 40); ctx.fill(); ctx.stroke(); },
            };
            ctx.fillStyle = clip.fontColor || '#4a9eff';
            ctx.strokeStyle = clip.textStrokeColor || '#ffffff';
            ctx.lineWidth = 2;
            const shapeFn = shapes[clip.name?.toLowerCase()] || shapes.circle;
            shapeFn();
        }

        _renderStickerClip(ctx, clip) {
            ctx.font = '48px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const stickerMap = { circle: '●', square: '■', star: '★', heart: '♥', check: '✓', cross: '✗', fire: '🔥', bolt: '⚡', crown: '👑' };
            ctx.fillText(stickerMap[clip.name?.toLowerCase()] || '★', 0, 0);
        }

        _drawStar(ctx, cx, cy, spikes, outerR, innerR) {
            let rot = Math.PI / 2 * 3;
            const step = Math.PI / spikes;
            ctx.beginPath(); ctx.moveTo(cx, cy - outerR);
            for (let i = 0; i < spikes; i++) {
                ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR); rot += step;
                ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR); rot += step;
            }
            ctx.lineTo(cx, cy - outerR); ctx.closePath();
        }

        _drawHeart(ctx, cx, cy, size) {
            ctx.beginPath();
            ctx.moveTo(cx, cy + size / 4);
            ctx.bezierCurveTo(cx, cy, cx - size / 2, cy, cx - size / 2, cy + size / 4);
            ctx.bezierCurveTo(cx - size / 2, cy + size / 2, cx, cy + size * 0.6, cx, cy + size * 0.8);
            ctx.bezierCurveTo(cx, cy + size * 0.6, cx + size / 2, cy + size / 2, cx + size / 2, cy + size / 4);
            ctx.bezierCurveTo(cx + size / 2, cy, cx, cy, cx, cy + size / 4);
            ctx.closePath();
        }

        _applyClipEffects(ctx, clip) {
            if (!clip.effects || clip.effects.length === 0) return;
            clip.effects.forEach(effect => {
                switch (effect.type) {
                    case 'blur': ctx.filter = `blur(${effect.value || 5}px)`; break;
                    case 'brightness': ctx.filter = `brightness(${1 + (effect.value || 0) / 100})`; break;
                    case 'contrast': ctx.filter = `contrast(${1 + (effect.value || 0) / 100})`; break;
                    case 'saturate': ctx.filter = `saturate(${1 + (effect.value || 0) / 100})`; break;
                    case 'hue-rotate': ctx.filter = `hue-rotate(${effect.value || 0}deg)`; break;
                    case 'grayscale': ctx.filter = `grayscale(${effect.value || 100}%)`; break;
                    case 'sepia': ctx.filter = `sepia(${effect.value || 100}%)`; break;
                    case 'invert': ctx.filter = `invert(${effect.value || 100}%)`; break;
                }
            });
            ctx.filter = 'none';
        }

        _renderBlankFrame() {
            if (!this.ctx || !this.canvas) return;
            const ctx = this.ctx;
            const dpr = window.devicePixelRatio;
            const w = this.canvas.width / dpr;
            const h = this.canvas.height / dpr;
            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#555';
            ctx.font = '16px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Tambahkan media ke timeline', w / 2, h / 2);
            ctx.restore();
        }

        _resumeAllMedia() {
            Object.values(this._videoElements).forEach(v => {
                try { v.play().catch(() => {}); } catch(e) {}
            });
        }

        _pauseAllMedia() {
            Object.values(this._videoElements).forEach(v => {
                try { v.pause(); } catch(e) {}
            });
        }

        _seekAllMedia(time) {
            const project = app.projectManager.getProject();
            if (!project) return;
            project.tracks.forEach(track => {
                track.clips.forEach(clip => {
                    if (clip.sourceUrl && clip.type === 'video') {
                        const videoEl = this._videoElements[clip.id];
                        if (videoEl && time >= clip.startTime && time < clip.endTime) {
                            const sourceTime = clip.inPoint + (time - clip.startTime) * clip.speed;
                            if (Math.abs(videoEl.currentTime - sourceTime) > 0.3) {
                                videoEl.currentTime = sourceTime;
                            }
                            if (this.isPlaying && videoEl.paused) {
                                try { videoEl.play().catch(() => {}); } catch(e) {}
                            }
                        } else if (videoEl) {
                            try { videoEl.pause(); } catch(e) {}
                        }
                    }
                });
            });
        }

        _applyVolumeToAll() {
            const vol = this.isMuted ? 0 : this.volume;
            Object.values(this._audioElements).forEach(a => { a.volume = vol; });
        }

        _updateVolumeIcon() {
            const btn = document.getElementById('mute-btn');
            if (!btn) return;
            let iconClass = 'fas fa-volume-up';
            if (this.volume === 0 || this.isMuted) iconClass = 'fas fa-volume-mute';
            else if (this.volume < 0.5) iconClass = 'fas fa-volume-down';
            btn.querySelector('i').className = iconClass;
        }

        _updateAudioMeters() {
            // Simulated audio meters for visual feedback
            const masterL = document.getElementById('master-meter-l');
            const masterR = document.getElementById('master-meter-r');
            if (masterL && masterR) {
                const project = app.projectManager.getProject();
                if (project && this.isPlaying) {
                    const level = 40 + Math.random() * 40;
                    masterL.style.height = level + '%';
                    masterR.style.height = (level - 5 + Math.random() * 10) + '%';
                } else {
                    masterL.style.height = '0%';
                    masterR.style.height = '0%';
                }
            }
        }

        takeSnapshot() {
            if (!this.canvas) return;
            const link = document.createElement('a');
            link.download = `zcut-snapshot-${Date.now()}.png`;
            link.href = this.canvas.toDataURL('image/png');
            link.click();
            if (app) app.eventBus.emit('toast:show', { type: 'success', message: 'Snapshot disimpan!' });
        }

        toggleFullscreen() {
            const viewport = document.getElementById('preview-viewport');
            if (!viewport) return;
            this.isFullscreen = !this.isFullscreen;
            if (this.isFullscreen) {
                viewport.classList.add('preview-fullscreen');
                viewport.requestFullscreen?.();
            } else {
                viewport.classList.remove('preview-fullscreen');
                document.exitFullscreen?.();
            }
        }

        destroy() {
            this.pause();
            Object.values(this._videoElements).forEach(v => { v.src = ''; v.load(); });
            Object.values(this._audioElements).forEach(a => { a.src = ''; a.load(); });
            this._videoElements = {};
            this._audioElements = {};
        }
    }

    // Initialize
    window.zcutPlayer = new Player();

    /* ============================================
       FEATURE 1: Canvas Compositing Modes
       Supports blend modes: multiply, screen, overlay, etc.
       ============================================ */

    /**
     * CompositingManager - Manages canvas compositing/blend modes for layers.
     * Provides an abstraction over CanvasRenderingContext2D.globalCompositeOperation
     * to support standard and advanced blend modes during multi-layer rendering.
     */
    class CompositingManager {
        constructor() {
            // Map of supported blend mode names to their canvas composite operation strings
            this.blendModes = {
                'normal': 'source-over',
                'multiply': 'multiply',
                'screen': 'screen',
                'overlay': 'overlay',
                'darken': 'darken',
                'lighten': 'lighten',
                'color-dodge': 'color-dodge',
                'color-burn': 'color-burn',
                'hard-light': 'hard-light',
                'soft-light': 'soft-light',
                'difference': 'difference',
                'exclusion': 'exclusion',
                'hue': 'hue',
                'saturation': 'saturation',
                'color': 'color',
                'luminosity': 'luminosity'
            };
            // Track the current blend mode per layer for layered rendering
            this._layerBlendModes = new Map();
            // Track per-layer opacity for alpha compositing
            this._layerOpacity = new Map();
        }

        /**
         * Set the blend mode for a specific layer identified by layerId.
         * @param {string} layerId - Unique identifier for the layer.
         * @param {string} mode - Blend mode name (e.g., 'multiply', 'screen').
         */
        setLayerBlendMode(layerId, mode) {
            if (this.blendModes[mode]) {
                this._layerBlendModes.set(layerId, mode);
            } else {
                console.warn(`CompositingManager: Unknown blend mode "${mode}", falling back to "normal".`);
                this._layerBlendModes.set(layerId, 'normal');
            }
        }

        /**
         * Set the opacity for a specific layer.
         * @param {string} layerId - Unique identifier for the layer.
         * @param {number} opacity - Opacity value between 0.0 and 1.0.
         */
        setLayerOpacity(layerId, opacity) {
            this._layerOpacity.set(layerId, Math.max(0, Math.min(1, opacity)));
        }

        /**
         * Apply the compositing settings for a layer to the given canvas context.
         * This should be called before drawing the layer content.
         * @param {CanvasRenderingContext2D} ctx - The canvas 2D rendering context.
         * @param {string} layerId - The layer identifier.
         */
        applyLayerComposite(ctx, layerId) {
            const mode = this._layerBlendModes.get(layerId) || 'normal';
            const opacity = this._layerOpacity.get(layerId);
            ctx.globalCompositeOperation = this.blendModes[mode] || 'source-over';
            if (opacity !== undefined) {
                ctx.globalAlpha = opacity;
            }
        }

        /**
         * Reset the canvas context to default compositing state.
         * Should be called after each layer is drawn.
         * @param {CanvasRenderingContext2D} ctx - The canvas 2D rendering context.
         */
        resetComposite(ctx) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1.0;
        }

        /**
         * Get a list of all available blend mode names.
         * @returns {string[]} Array of blend mode names.
         */
        getAvailableBlendModes() {
            return Object.keys(this.blendModes);
        }

        /**
         * Perform a composite blend between two ImageData objects using a specified mode.
         * This is a pixel-level fallback for blend modes not natively supported by Canvas2D.
         * @param {ImageData} base - The base (bottom) image data.
         * @param {ImageData} overlay - The overlay (top) image data.
         * @param {string} mode - Blend mode name.
         * @param {number} opacity - Blend opacity (0-1).
         * @returns {ImageData} The resulting blended image data.
         */
        blendImageData(base, overlay, mode, opacity) {
            const result = new ImageData(
                new Uint8ClampedArray(base.data),
                base.width, base.height
            );
            const bd = base.data;
            const od = overlay.data;
            const rd = result.data;
            const len = bd.length;

            for (let i = 0; i < len; i += 4) {
                const bR = bd[i], bG = bd[i + 1], bB = bd[i + 2];
                const oR = od[i], oG = od[i + 1], oB = od[i + 2];
                const a = (od[i + 3] / 255) * opacity;
                let rR, rG, rB;

                switch (mode) {
                    case 'multiply':
                        rR = bR * oR / 255;
                        rG = bG * oG / 255;
                        rB = bB * oB / 255;
                        break;
                    case 'screen':
                        rR = 255 - ((255 - bR) * (255 - oR)) / 255;
                        rG = 255 - ((255 - bG) * (255 - oG)) / 255;
                        rB = 255 - ((255 - bB) * (255 - oB)) / 255;
                        break;
                    case 'overlay':
                        rR = bR < 128 ? (2 * bR * oR) / 255 : 255 - (2 * (255 - bR) * (255 - oR)) / 255;
                        rG = bG < 128 ? (2 * bG * oG) / 255 : 255 - (2 * (255 - bG) * (255 - oG)) / 255;
                        rB = bB < 128 ? (2 * bB * oB) / 255 : 255 - (2 * (255 - bB) * (255 - oB)) / 255;
                        break;
                    case 'difference':
                        rR = Math.abs(bR - oR);
                        rG = Math.abs(bG - oG);
                        rB = Math.abs(bB - oB);
                        break;
                    case 'exclusion':
                        rR = bR + oR - (2 * bR * oR) / 255;
                        rG = bG + oG - (2 * bG * oG) / 255;
                        rB = bB + oB - (2 * bB * oB) / 255;
                        break;
                    case 'color-dodge':
                        rR = oR === 0 ? 0 : Math.min(255, (bR * 255) / (255 - oR));
                        rG = oG === 0 ? 0 : Math.min(255, (bG * 255) / (255 - oG));
                        rB = oB === 0 ? 0 : Math.min(255, (bB * 255) / (255 - oB));
                        break;
                    case 'color-burn':
                        rR = oR === 255 ? 255 : Math.max(0, 255 - ((255 - bR) * 255) / oR);
                        rG = oG === 255 ? 255 : Math.max(0, 255 - ((255 - bG) * 255) / oG);
                        rB = oB === 255 ? 255 : Math.max(0, 255 - ((255 - bB) * 255) / oB);
                        break;
                    case 'hard-light':
                        rR = oR < 128 ? (2 * bR * oR) / 255 : 255 - (2 * (255 - bR) * (255 - oR)) / 255;
                        rG = oG < 128 ? (2 * bG * oG) / 255 : 255 - (2 * (255 - bG) * (255 - oG)) / 255;
                        rB = oB < 128 ? (2 * bB * oB) / 255 : 255 - (2 * (255 - bB) * (255 - oB)) / 255;
                        break;
                    case 'soft-light':
                        rR = oR < 128 ? bR - (255 - 2 * oR) * bR * (255 - bR) / (255 * 255)
                            : bR + (2 * oR - 255) * (Math.sqrt(bR / 255) * 255 - bR) / 255;
                        rG = oG < 128 ? bG - (255 - 2 * oG) * bG * (255 - bG) / (255 * 255)
                            : bG + (2 * oG - 255) * (Math.sqrt(bG / 255) * 255 - bG) / 255;
                        rB = oB < 128 ? bB - (255 - 2 * oB) * bB * (255 - bB) / (255 * 255)
                            : bB + (2 * oB - 255) * (Math.sqrt(bB / 255) * 255 - bB) / 255;
                        break;
                    default:
                        rR = oR; rG = oG; rB = oB;
                }

                // Alpha composite the blend result over the base
                rd[i] = Math.round(bR * (1 - a) + rR * a);
                rd[i + 1] = Math.round(bG * (1 - a) + rG * a);
                rd[i + 2] = Math.round(bB * (1 - a) + rB * a);
                rd[i + 3] = Math.max(bd[i + 3], od[i + 3]);
            }
            return result;
        }

        /**
         * Clear all layer compositing settings.
         */
        resetAll() {
            this._layerBlendModes.clear();
            this._layerOpacity.clear();
        }
    }

    /* ============================================
       FEATURE 2: Video Decoding Pipeline
       Frame-accurate seeking and caching for video clips
       ============================================ */

    /**
     * VideoDecodePipeline - Manages frame-accurate video decoding with a
     * frame cache to reduce redundant seek operations. Uses OffscreenCanvas
     * when available for efficient frame extraction.
     */
    class VideoDecodePipeline {
        constructor() {
            // Map of video source URL -> { video, offscreen, ctx, cache }
            this._pipelines = new Map();
            // Maximum number of cached frames per video source
            this._maxCacheSize = 60;
            // Frame cache: Map<sourceUrl, Map<frameNumber, ImageBitmap|ImageData>>
            this._frameCache = new Map();
        }

        /**
         * Register a video source with the decode pipeline.
         * Creates a hidden video element and optional offscreen canvas for frame extraction.
         * @param {string} sourceUrl - The URL of the video source.
         * @param {number} width - Target width for decoded frames.
         * @param {number} height - Target height for decoded frames.
         * @returns {Promise<HTMLVideoElement>} The created video element.
         */
        async registerSource(sourceUrl, width, height) {
            if (this._pipelines.has(sourceUrl)) {
                return this._pipelines.get(sourceUrl).video;
            }

            const video = document.createElement('video');
            video.src = sourceUrl;
            video.muted = true;
            video.preload = 'auto';
            video.playsInline = true;
            video.crossOrigin = 'anonymous';

            // Wait for metadata to load so we know duration and dimensions
            await new Promise((resolve, reject) => {
                video.addEventListener('loadedmetadata', resolve, { once: true });
                video.addEventListener('error', reject, { once: true });
            });

            const w = width || video.videoWidth || 1920;
            const h = height || video.videoHeight || 1080;

            // Create offscreen canvas for frame extraction if available
            let offscreen = null;
            let offCtx = null;
            if (typeof OffscreenCanvas !== 'undefined') {
                offscreen = new OffscreenCanvas(w, h);
                offCtx = offscreen.getContext('2d');
            } else {
                offscreen = document.createElement('canvas');
                offscreen.width = w;
                offscreen.height = h;
                offCtx = offscreen.getContext('2d');
            }

            this._pipelines.set(sourceUrl, {
                video,
                offscreen,
                ctx: offCtx,
                width: w,
                height: h,
                fps: 30 // Default, can be overridden
            });
            this._frameCache.set(sourceUrl, new Map());

            return video;
        }

        /**
         * Seek to a frame-accurate position and capture the frame.
         * Uses the cached frame if available; otherwise seeks, waits for the
         * 'seeked' event, and draws the frame to the offscreen canvas.
         * @param {string} sourceUrl - The registered video source URL.
         * @param {number} timeSeconds - The target time in seconds.
         * @param {number} fps - Frames per second for frame number calculation.
         * @returns {Promise<ImageData>} The decoded frame as ImageData.
         */
        async seekAndCapture(sourceUrl, timeSeconds, fps) {
            const pipeline = this._pipelines.get(sourceUrl);
            if (!pipeline) {
                throw new Error(`VideoDecodePipeline: Source "${sourceUrl}" not registered.`);
            }

            const frameNum = Math.round(timeSeconds * (fps || 30));
            const cache = this._frameCache.get(sourceUrl);

            // Check cache first
            if (cache && cache.has(frameNum)) {
                return cache.get(frameNum);
            }

            const { video, offscreen, ctx, width, height } = pipeline;

            // Perform frame-accurate seek
            video.currentTime = timeSeconds;
            await new Promise((resolve) => {
                video.addEventListener('seeked', resolve, { once: true });
            });

            // Draw current video frame to offscreen canvas
            ctx.drawImage(video, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);

            // Store in cache (evict oldest if over limit)
            if (cache) {
                if (cache.size >= this._maxCacheSize) {
                    // Remove the oldest cached frame (first key in Map iteration order)
                    const firstKey = cache.keys().next().value;
                    cache.delete(firstKey);
                }
                cache.set(frameNum, imageData);
            }

            return imageData;
        }

        /**
         * Pre-cache a range of frames for smoother playback.
         * @param {string} sourceUrl - The registered video source URL.
         * @param {number} startTime - Start time in seconds.
         * @param {number} endTime - End time in seconds.
         * @param {number} fps - Frames per second.
         * @returns {Promise<number>} Number of frames cached.
         */
        async preCacheRange(sourceUrl, startTime, endTime, fps) {
            const actualFps = fps || 30;
            const startFrame = Math.round(startTime * actualFps);
            const endFrame = Math.round(endTime * actualFps);
            let cached = 0;

            for (let f = startFrame; f <= endFrame; f++) {
                const time = f / actualFps;
                await this.seekAndCapture(sourceUrl, time, actualFps);
                cached++;
            }
            return cached;
        }

        /**
         * Get the video element for a registered source.
         * @param {string} sourceUrl - The source URL.
         * @returns {HTMLVideoElement|null}
         */
        getVideo(sourceUrl) {
            const pipeline = this._pipelines.get(sourceUrl);
            return pipeline ? pipeline.video : null;
        }

        /**
         * Clear the frame cache for a specific source or all sources.
         * @param {string} [sourceUrl] - If provided, clear only this source's cache.
         */
        clearCache(sourceUrl) {
            if (sourceUrl) {
                this._frameCache.get(sourceUrl)?.clear();
            } else {
                this._frameCache.forEach(cache => cache.clear());
            }
        }

        /**
         * Unregister a video source and release resources.
         * @param {string} sourceUrl - The source URL to unregister.
         */
        unregisterSource(sourceUrl) {
            const pipeline = this._pipelines.get(sourceUrl);
            if (pipeline) {
                pipeline.video.src = '';
                pipeline.video.load();
            }
            this._pipelines.delete(sourceUrl);
            this._frameCache.delete(sourceUrl);
        }

        /**
         * Destroy the pipeline and release all resources.
         */
        destroy() {
            this._pipelines.forEach((pipeline) => {
                pipeline.video.src = '';
                pipeline.video.load();
            });
            this._pipelines.clear();
            this._frameCache.forEach(cache => cache.clear());
            this._frameCache.clear();
        }
    }

    /* ============================================
       FEATURE 3: Audio Visualization
       Real-time audio spectrum analyzer display
       ============================================ */

    /**
     * AudioVisualizer - Provides real-time audio spectrum analysis
     * and waveform visualization using the Web Audio API.
     */
    class AudioVisualizer {
        constructor() {
            /** @type {AudioContext|null} */
            this._audioCtx = null;
            /** @type {AnalyserNode|null} */
            this._analyser = null;
            /** @type {Map<string, { source: MediaElementAudioSourceNode, element: HTMLAudioElement|HTMLVideoElement }>} */
            this._sources = new Map();
            // Visualization configuration
            this.fftSize = 2048;
            this.smoothingTimeConstant = 0.8;
            this.minDecibels = -100;
            this.maxDecibels = -30;
            // Cached frequency/time domain data
            this._frequencyData = null;
            this._timeDomainData = null;
        }

        /**
         * Initialize the AudioContext and AnalyserNode.
         * Must be called from a user gesture handler on some browsers.
         */
        init() {
            if (this._audioCtx) return;
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                console.warn('AudioVisualizer: Web Audio API not supported.');
                return;
            }
            this._audioCtx = new AudioCtx();
            this._analyser = this._audioCtx.createAnalyser();
            this._analyser.fftSize = this.fftSize;
            this._analyser.smoothingTimeConstant = this.smoothingTimeConstant;
            this._analyser.minDecibels = this.minDecibels;
            this._analyser.maxDecibels = this.maxDecibels;
            this._analyser.connect(this._audioCtx.destination);
        }

        /**
         * Connect an audio/video element to the visualizer for analysis.
         * @param {string} id - Unique identifier for this source.
         * @param {HTMLAudioElement|HTMLVideoElement} element - The media element.
         */
        connectSource(id, element) {
            if (!this._audioCtx || !this._analyser) this.init();
            if (this._sources.has(id)) return; // Already connected

            try {
                const source = this._audioCtx.createMediaElementSource(element);
                source.connect(this._analyser);
                this._sources.set(id, { source, element });
            } catch (e) {
                console.warn(`AudioVisualizer: Could not connect source "${id}":`, e);
            }
        }

        /**
         * Disconnect a source by its identifier.
         * @param {string} id - The source identifier.
         */
        disconnectSource(id) {
            const entry = this._sources.get(id);
            if (entry) {
                try { entry.source.disconnect(); } catch (e) { /* ignore */ }
                this._sources.delete(id);
            }
        }

        /**
         * Get the current frequency domain data (spectrum).
         * @returns {Uint8Array|null} Array of frequency magnitudes (0-255).
         */
        getFrequencyData() {
            if (!this._analyser) return null;
            if (!this._frequencyData || this._frequencyData.length !== this._analyser.frequencyBinCount) {
                this._frequencyData = new Uint8Array(this._analyser.frequencyBinCount);
            }
            this._analyser.getByteFrequencyData(this._frequencyData);
            return this._frequencyData;
        }

        /**
         * Get the current time domain data (waveform).
         * @returns {Uint8Array|null} Array of waveform amplitudes (0-255).
         */
        getTimeDomainData() {
            if (!this._analyser) return null;
            if (!this._timeDomainData || this._timeDomainData.length !== this._analyser.fftSize) {
                this._timeDomainData = new Uint8Array(this._analyser.fftSize);
            }
            this._analyser.getByteTimeDomainData(this._timeDomainData);
            return this._timeDomainData;
        }

        /**
         * Render a spectrum analyzer (bar graph) to a canvas context.
         * @param {CanvasRenderingContext2D} ctx - Target canvas context.
         * @param {number} x - X position.
         * @param {number} y - Y position.
         * @param {number} width - Width of the visualization.
         * @param {number} height - Height of the visualization.
         * @param {Object} [options] - Rendering options.
         * @param {string} [options.barColor='#4a9eff'] - Color of the bars.
         * @param {number} [options.barCount=64] - Number of bars to render.
         * @param {number} [options.barGap=2] - Gap between bars in pixels.
         * @param {boolean} [options.mirrored=false] - Mirror bars vertically.
         */
        renderSpectrum(ctx, x, y, width, height, options) {
            const freqData = this.getFrequencyData();
            if (!freqData) return;

            const opts = options || {};
            const barColor = opts.barColor || '#4a9eff';
            const barCount = opts.barCount || 64;
            const barGap = opts.barGap || 2;
            const mirrored = opts.mirrored || false;

            const barWidth = (width - (barCount - 1) * barGap) / barCount;
            const step = Math.floor(freqData.length / barCount);

            for (let i = 0; i < barCount; i++) {
                // Average frequency values for this bar
                let sum = 0;
                for (let j = 0; j < step; j++) {
                    sum += freqData[i * step + j];
                }
                const value = sum / step / 255;
                const barHeight = value * height;

                ctx.fillStyle = barColor;
                ctx.globalAlpha = 0.6 + value * 0.4;

                if (mirrored) {
                    const halfH = height / 2;
                    const halfBar = barHeight / 2;
                    ctx.fillRect(
                        x + i * (barWidth + barGap),
                        y + halfH - halfBar,
                        barWidth,
                        halfBar
                    );
                    ctx.fillRect(
                        x + i * (barWidth + barGap),
                        y + halfH,
                        barWidth,
                        halfBar
                    );
                } else {
                    ctx.fillRect(
                        x + i * (barWidth + barGap),
                        y + height - barHeight,
                        barWidth,
                        barHeight
                    );
                }
            }
            ctx.globalAlpha = 1.0;
        }

        /**
         * Render a waveform (oscilloscope) to a canvas context.
         * @param {CanvasRenderingContext2D} ctx - Target canvas context.
         * @param {number} x - X position.
         * @param {number} y - Y position.
         * @param {number} width - Width of the visualization.
         * @param {number} height - Height of the visualization.
         * @param {Object} [options] - Rendering options.
         * @param {string} [options.lineColor='#4a9eff'] - Color of the waveform line.
         * @param {number} [options.lineWidth=2] - Width of the waveform line.
         */
        renderWaveform(ctx, x, y, width, height, options) {
            const timeData = this.getTimeDomainData();
            if (!timeData) return;

            const opts = options || {};
            const lineColor = opts.lineColor || '#4a9eff';
            const lineWidth = opts.lineWidth || 2;

            ctx.strokeStyle = lineColor;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();

            const sliceWidth = width / timeData.length;
            let currentX = x;

            for (let i = 0; i < timeData.length; i++) {
                const v = timeData[i] / 128.0; // Normalize to 0-2 range
                const currentY = y + (v * height) / 2;
                if (i === 0) ctx.moveTo(currentX, currentY);
                else ctx.lineTo(currentX, currentY);
                currentX += sliceWidth;
            }
            ctx.stroke();
        }

        /**
         * Destroy the visualizer and release all audio resources.
         */
        destroy() {
            this._sources.forEach((entry) => {
                try { entry.source.disconnect(); } catch (e) { /* ignore */ }
            });
            this._sources.clear();
            if (this._audioCtx) {
                this._audioCtx.close();
                this._audioCtx = null;
            }
            this._analyser = null;
        }
    }

    /* ============================================
       FEATURE 4: Multi-Layer Rendering
       Proper Z-order rendering with alpha compositing
       ============================================ */

    /**
     * MultiLayerRenderer - Renders multiple layers with proper Z-ordering
     * and alpha compositing. Each layer can have its own blend mode, opacity,
     * and transformation. Layers are rendered bottom-to-top.
     */
    class MultiLayerRenderer {
        constructor() {
            /** @type {Array} Ordered list of layer descriptors (bottom first) */
            this._layers = [];
            /** @type {CompositingManager} Shared compositing manager */
            this._compositing = new CompositingManager();
        }

        /**
         * Add a layer to the renderer.
         * @param {Object} layerDesc - Layer descriptor.
         * @param {string} layerDesc.id - Unique layer identifier.
         * @param {number} layerDesc.zIndex - Z-order (lower = rendered first = behind).
         * @param {string} [layerDesc.blendMode='normal'] - Blend mode for this layer.
         * @param {number} [layerDesc.opacity=1.0] - Layer opacity (0-1).
         * @param {number} [layerDesc.x=0] - X position offset.
         * @param {number} [layerDesc.y=0] - Y position offset.
         * @param {number} [layerDesc.scale=1.0] - Scale factor.
         * @param {number} [layerDesc.rotation=0] - Rotation in degrees.
         * @param {Function} layerDesc.renderFn - Function(ctx, width, height) that draws the layer.
         */
        addLayer(layerDesc) {
            const layer = {
                id: layerDesc.id || ('layer_' + Date.now() + '_' + Math.random()),
                zIndex: layerDesc.zIndex || 0,
                blendMode: layerDesc.blendMode || 'normal',
                opacity: layerDesc.opacity !== undefined ? layerDesc.opacity : 1.0,
                x: layerDesc.x || 0,
                y: layerDesc.y || 0,
                scale: layerDesc.scale || 1.0,
                rotation: layerDesc.rotation || 0,
                visible: layerDesc.visible !== undefined ? layerDesc.visible : true,
                renderFn: layerDesc.renderFn || function() {}
            };
            this._layers.push(layer);
            this._compositing.setLayerBlendMode(layer.id, layer.blendMode);
            this._compositing.setLayerOpacity(layer.id, layer.opacity);
            // Sort layers by zIndex (ascending) for proper Z-order
            this._layers.sort((a, b) => a.zIndex - b.zIndex);
            return layer.id;
        }

        /**
         * Remove a layer by its identifier.
         * @param {string} layerId - The layer identifier to remove.
         */
        removeLayer(layerId) {
            this._layers = this._layers.filter(l => l.id !== layerId);
        }

        /**
         * Update a layer's properties.
         * @param {string} layerId - The layer identifier.
         * @param {Object} props - Properties to update.
         */
        updateLayer(layerId, props) {
            const layer = this._layers.find(l => l.id === layerId);
            if (!layer) return;
            if (props.zIndex !== undefined) layer.zIndex = props.zIndex;
            if (props.blendMode !== undefined) {
                layer.blendMode = props.blendMode;
                this._compositing.setLayerBlendMode(layerId, props.blendMode);
            }
            if (props.opacity !== undefined) {
                layer.opacity = props.opacity;
                this._compositing.setLayerOpacity(layerId, props.opacity);
            }
            if (props.x !== undefined) layer.x = props.x;
            if (props.y !== undefined) layer.y = props.y;
            if (props.scale !== undefined) layer.scale = props.scale;
            if (props.rotation !== undefined) layer.rotation = props.rotation;
            if (props.visible !== undefined) layer.visible = props.visible;
            if (props.renderFn !== undefined) layer.renderFn = props.renderFn;
            // Re-sort if zIndex changed
            if (props.zIndex !== undefined) {
                this._layers.sort((a, b) => a.zIndex - b.zIndex);
            }
        }

        /**
         * Render all visible layers to the target canvas context.
         * Layers are drawn in Z-order (bottom to top) with their respective
         * blend modes and opacities applied via alpha compositing.
         * @param {CanvasRenderingContext2D} ctx - Target canvas context.
         * @param {number} width - Canvas width.
         * @param {number} height - Canvas height.
         */
        render(ctx, width, height) {
            for (const layer of this._layers) {
                if (!layer.visible) continue;

                ctx.save();

                // Apply layer transformation
                ctx.translate(layer.x, layer.y);
                if (layer.rotation !== 0) {
                    ctx.translate(width / 2, height / 2);
                    ctx.rotate(layer.rotation * Math.PI / 180);
                    ctx.translate(-width / 2, -height / 2);
                }
                if (layer.scale !== 1.0) {
                    ctx.translate(width / 2, height / 2);
                    ctx.scale(layer.scale, layer.scale);
                    ctx.translate(-width / 2, -height / 2);
                }

                // Apply compositing (blend mode + opacity)
                this._compositing.applyLayerComposite(ctx, layer.id);

                // Render the layer content
                layer.renderFn(ctx, width, height);

                // Reset compositing for next layer
                this._compositing.resetComposite(ctx);

                ctx.restore();
            }
        }

        /**
         * Get a layer descriptor by ID.
         * @param {string} layerId
         * @returns {Object|null}
         */
        getLayer(layerId) {
            return this._layers.find(l => l.id === layerId) || null;
        }

        /**
         * Get all layer descriptors in Z-order.
         * @returns {Array}
         */
        getAllLayers() {
            return [...this._layers];
        }

        /**
         * Clear all layers.
         */
        clear() {
            this._layers = [];
            this._compositing.resetAll();
        }
    }

    /* ============================================
       FEATURE 5: GPU-Accelerated Effects
       Use WebGL for certain effects when available
       ============================================ */

    /**
     * GPUEffectsProcessor - Applies visual effects using WebGL shaders
     * when a WebGL context is available. Falls back to Canvas2D pixel
     * manipulation when WebGL is not supported or for simple effects.
     */
    class GPUEffectsProcessor {
        constructor() {
            /** @type {WebGLRenderingContext|null} */
            this._gl = null;
            /** @type {HTMLCanvasElement|null} */
            this._glCanvas = null;
            /** @type {Map<string, WebGLProgram>} Cached shader programs */
            this._programs = new Map();
            this._initialized = false;
        }

        /**
         * Initialize the WebGL context on a hidden canvas.
         * @param {number} [width=1920] - Canvas width.
         * @param {number} [height=1080] - Canvas height.
         * @returns {boolean} True if WebGL is available and initialized.
         */
        init(width, height) {
            if (this._initialized) return true;
            const w = width || 1920;
            const h = height || 1080;

            this._glCanvas = document.createElement('canvas');
            this._glCanvas.width = w;
            this._glCanvas.height = h;

            this._gl = this._glCanvas.getContext('webgl') ||
                       this._glCanvas.getContext('experimental-webgl');

            if (!this._gl) {
                console.warn('GPUEffectsProcessor: WebGL not available, falling back to CPU.');
                return false;
            }

            this._initialized = true;
            return true;
        }

        /**
         * Compile a vertex + fragment shader pair into a WebGL program.
         * @param {string} name - Program name for caching.
         * @param {string} vertSrc - Vertex shader source.
         * @param {string} fragSrc - Fragment shader source.
         * @returns {WebGLProgram|null} The compiled program, or null on error.
         */
        compileProgram(name, vertSrc, fragSrc) {
            if (!this._gl) return null;
            const gl = this._gl;

            const compileShader = (type, source) => {
                const shader = gl.createShader(type);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    console.error('GPUEffectsProcessor: Shader compile error:', gl.getShaderInfoLog(shader));
                    gl.deleteShader(shader);
                    return null;
                }
                return shader;
            };

            const vert = compileShader(gl.VERTEX_SHADER, vertSrc);
            const frag = compileShader(gl.FRAGMENT_SHADER, fragSrc);
            if (!vert || !frag) return null;

            const program = gl.createProgram();
            gl.attachShader(program, vert);
            gl.attachShader(program, frag);
            gl.linkProgram(program);

            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error('GPUEffectsProcessor: Program link error:', gl.getProgramInfoLog(program));
                gl.deleteProgram(program);
                return null;
            }

            this._programs.set(name, program);
            return program;
        }

        /**
         * Apply a blur effect using WebGL. Falls back to Canvas2D if unavailable.
         * @param {ImageData} imageData - Input image data.
         * @param {number} radius - Blur radius in pixels.
         * @param {number} width - Image width.
         * @param {number} height - Image height.
         * @returns {ImageData} Blurred image data.
         */
        applyGPUBlur(imageData, radius, width, height) {
            if (!this._initialized && !this.init(width, height)) {
                // Fallback: simple box blur on CPU
                return this._cpuBoxBlur(imageData, radius, width, height);
            }

            const gl = this._gl;
            const programName = 'blur';
            let program = this._programs.get(programName);

            if (!program) {
                const vertSrc = [
                    'attribute vec2 a_position;',
                    'attribute vec2 a_texCoord;',
                    'varying vec2 v_texCoord;',
                    'void main() {',
                    '  gl_Position = vec4(a_position, 0.0, 1.0);',
                    '  v_texCoord = a_texCoord;',
                    '}'
                ].join('\n');

                const fragSrc = [
                    'precision mediump float;',
                    'uniform sampler2D u_image;',
                    'uniform vec2 u_textureSize;',
                    'uniform float u_radius;',
                    'varying vec2 v_texCoord;',
                    'void main() {',
                    '  vec2 onePixel = vec2(1.0) / u_textureSize;',
                    '  vec4 color = vec4(0.0);',
                    '  float total = 0.0;',
                    '  for (float x = -4.0; x <= 4.0; x += 1.0) {',
                    '    for (float y = -4.0; y <= 4.0; y += 1.0) {',
                    '      float weight = exp(-(x*x + y*y) / (2.0 * u_radius * u_radius));',
                    '      color += texture2D(u_image, v_texCoord + vec2(x, y) * onePixel) * weight;',
                    '      total += weight;',
                    '    }',
                    '  }',
                    '  gl_FragColor = color / total;',
                    '}'
                ].join('\n');

                program = this.compileProgram(programName, vertSrc, fragSrc);
                if (!program) return this._cpuBoxBlur(imageData, radius, width, height);
            }

            gl.useProgram(program);

            // Upload texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData.data);

            // Set uniforms
            const texSizeLoc = gl.getUniformLocation(program, 'u_textureSize');
            gl.uniform2f(texSizeLoc, width, height);
            const radiusLoc = gl.getUniformLocation(program, 'u_radius');
            gl.uniform1f(radiusLoc, Math.max(0.1, radius));

            // Setup geometry (full-screen quad)
            const posBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                -1, -1, 1, -1, -1, 1,
                -1, 1, 1, -1, 1, 1
            ]), gl.STATIC_DRAW);
            const posLoc = gl.getAttribLocation(program, 'a_position');
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            const texBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                0, 1, 1, 1, 0, 0,
                0, 0, 1, 1, 1, 0
            ]), gl.STATIC_DRAW);
            const texLoc = gl.getAttribLocation(program, 'a_texCoord');
            gl.enableVertexAttribArray(texLoc);
            gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

            // Render
            gl.viewport(0, 0, width, height);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Read pixels back
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            // Cleanup
            gl.deleteTexture(texture);
            gl.deleteBuffer(posBuffer);
            gl.deleteBuffer(texBuffer);

            return new ImageData(new Uint8ClampedArray(pixels), width, height);
        }

        /**
         * CPU-based box blur fallback.
         * @private
         */
        _cpuBoxBlur(imageData, radius, width, height) {
            const src = imageData.data;
            const output = new Uint8ClampedArray(src.length);
            const r = Math.max(1, Math.round(radius));
            const div = (2 * r + 1) * (2 * r + 1);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
                    for (let ky = -r; ky <= r; ky++) {
                        for (let kx = -r; kx <= r; kx++) {
                            const px = Math.min(width - 1, Math.max(0, x + kx));
                            const py = Math.min(height - 1, Math.max(0, y + ky));
                            const idx = (py * width + px) * 4;
                            sumR += src[idx];
                            sumG += src[idx + 1];
                            sumB += src[idx + 2];
                            sumA += src[idx + 3];
                        }
                    }
                    const i = (y * width + x) * 4;
                    output[i] = sumR / div;
                    output[i + 1] = sumG / div;
                    output[i + 2] = sumB / div;
                    output[i + 3] = sumA / div;
                }
            }
            return new ImageData(output, width, height);
        }

        /**
         * Check if WebGL is available.
         * @returns {boolean}
         */
        isWebGLAvailable() {
            return this._initialized || !!document.createElement('canvas').getContext('webgl');
        }

        /**
         * Destroy the GPU processor and release WebGL resources.
         */
        destroy() {
            if (this._gl) {
                this._programs.forEach(program => this._gl.deleteProgram(program));
                this._programs.clear();
                // Lose context if possible
                const ext = this._gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
                this._gl = null;
            }
            this._glCanvas = null;
            this._initialized = false;
        }
    }

    /* ============================================
       FEATURE 6: Frame Interpolation
       Generate intermediate frames for smooth slow motion
       ============================================ */

    /**
     * FrameInterpolator - Generates intermediate frames between two given frames
     * to achieve smooth slow motion playback. Uses optical flow estimation
     * (simplified block-matching) and pixel blending for interpolation.
     */
    class FrameInterpolator {
        constructor() {
            // Block size for motion estimation
            this.blockSize = 8;
            // Search range for block matching
            this.searchRange = 16;
        }

        /**
         * Interpolate a frame between two given frames at a specified position.
         * @param {ImageData} frameA - The first (earlier) frame.
         * @param {ImageData} frameB - The second (later) frame.
         * @param {number} t - Interpolation factor (0.0 = frameA, 1.0 = frameB).
         * @returns {ImageData} The interpolated frame.
         */
        interpolate(frameA, frameB, t) {
            const w = frameA.width;
            const h = frameA.height;
            const dataA = frameA.data;
            const dataB = frameB.data;
            const output = new ImageData(w, h);
            const out = output.data;

            // Simple linear blend for the base interpolation
            for (let i = 0; i < dataA.length; i += 4) {
                out[i] = Math.round(dataA[i] * (1 - t) + dataB[i] * t);
                out[i + 1] = Math.round(dataA[i + 1] * (1 - t) + dataB[i + 1] * t);
                out[i + 2] = Math.round(dataA[i + 2] * (1 - t) + dataB[i + 2] * t);
                out[i + 3] = Math.round(dataA[i + 3] * (1 - t) + dataB[i + 3] * t);
            }

            return output;
        }

        /**
         * Estimate motion vectors between two frames using block matching.
         * Returns a motion vector field that can be used for motion-compensated
         * interpolation.
         * @param {ImageData} frameA - Reference frame.
         * @param {ImageData} frameB - Target frame.
         * @returns {Array} 2D array of motion vectors [{dx, dy}, ...].
         */
        estimateMotionVectors(frameA, frameB) {
            const w = frameA.width;
            const h = frameA.height;
            const dataA = frameA.data;
            const dataB = frameB.data;
            const bs = this.blockSize;
            const sr = this.searchRange;
            const vectors = [];

            const blocksX = Math.floor(w / bs);
            const blocksY = Math.floor(h / bs);

            for (let by = 0; by < blocksY; by++) {
                const row = [];
                for (let bx = 0; bx < blocksX; bx++) {
                    let bestDx = 0, bestDy = 0;
                    let bestSAD = Infinity;

                    // Search for the best matching block in frameB
                    for (let dy = -sr; dy <= sr; dy += 2) {
                        for (let dx = -sr; dx <= sr; dx += 2) {
                            let sad = 0;
                            for (let ky = 0; ky < bs; ky += 2) {
                                for (let kx = 0; kx < bs; kx += 2) {
                                    const ax = bx * bs + kx;
                                    const ay = by * bs + ky;
                                    const bxp = Math.min(w - 1, Math.max(0, ax + dx));
                                    const byp = Math.min(h - 1, Math.max(0, ay + dy));
                                    const idxA = (ay * w + ax) * 4;
                                    const idxB = (byp * w + bxp) * 4;
                                    sad += Math.abs(dataA[idxA] - dataB[idxB]);
                                    sad += Math.abs(dataA[idxA + 1] - dataB[idxB + 1]);
                                    sad += Math.abs(dataA[idxA + 2] - dataB[idxB + 2]);
                                }
                            }
                            if (sad < bestSAD) {
                                bestSAD = sad;
                                bestDx = dx;
                                bestDy = dy;
                            }
                        }
                    }
                    row.push({ dx: bestDx, dy: bestDy });
                }
                vectors.push(row);
            }
            return vectors;
        }

        /**
         * Motion-compensated frame interpolation.
         * Uses estimated motion vectors to shift pixels before blending.
         * @param {ImageData} frameA - First frame.
         * @param {ImageData} frameB - Second frame.
         * @param {number} t - Interpolation factor (0-1).
         * @returns {ImageData} Interpolated frame with motion compensation.
         */
        interpolateWithMotion(frameA, frameB, t) {
            const w = frameA.width;
            const h = frameA.height;
            const dataA = frameA.data;
            const dataB = frameB.data;
            const vectors = this.estimateMotionVectors(frameA, frameB);
            const output = new ImageData(w, h);
            const out = output.data;
            const bs = this.blockSize;

            for (let by = 0; by < vectors.length; by++) {
                for (let bx = 0; bx < vectors[by].length; bx++) {
                    const mv = vectors[by][bx];
                    // Shift pixels by half the motion vector for intermediate position
                    const shiftX = Math.round(mv.dx * t);
                    const shiftY = Math.round(mv.dy * t);

                    for (let ky = 0; ky < bs; ky++) {
                        for (let kx = 0; kx < bs; kx++) {
                            const ax = bx * bs + kx;
                            const ay = by * bs + ky;
                            if (ax >= w || ay >= h) continue;

                            // Shifted position in frameA (forward)
                            const sax = Math.min(w - 1, Math.max(0, ax + shiftX));
                            const say = Math.min(h - 1, Math.max(0, ay + shiftY));
                            // Shifted position in frameB (backward)
                            const sbx = Math.min(w - 1, Math.max(0, ax - mv.dx + shiftX));
                            const sby = Math.min(h - 1, Math.max(0, ay - mv.dy + shiftY));

                            const idxAShifted = (say * w + sax) * 4;
                            const idxBShifted = (sby * w + sbx) * 4;
                            const idxOut = (ay * w + ax) * 4;

                            out[idxOut] = Math.round(dataA[idxAShifted] * (1 - t) + dataB[idxBShifted] * t);
                            out[idxOut + 1] = Math.round(dataA[idxAShifted + 1] * (1 - t) + dataB[idxBShifted + 1] * t);
                            out[idxOut + 2] = Math.round(dataA[idxAShifted + 2] * (1 - t) + dataB[idxBShifted + 2] * t);
                            out[idxOut + 3] = 255;
                        }
                    }
                }
            }
            return output;
        }

        /**
         * Generate N intermediate frames between frameA and frameB.
         * @param {ImageData} frameA - First frame.
         * @param {ImageData} frameB - Second frame.
         * @param {number} numFrames - Number of intermediate frames to generate.
         * @param {boolean} [useMotion=false] - Whether to use motion-compensated interpolation.
         * @returns {ImageData[]} Array of interpolated frames.
         */
        generateFrames(frameA, frameB, numFrames, useMotion) {
            const frames = [];
            for (let i = 1; i <= numFrames; i++) {
                const t = i / (numFrames + 1);
                if (useMotion) {
                    frames.push(this.interpolateWithMotion(frameA, frameB, t));
                } else {
                    frames.push(this.interpolate(frameA, frameB, t));
                }
            }
            return frames;
        }
    }

    /* ============================================
       FEATURE 7: Color Space Conversion
       Convert between sRGB, Rec.709, Rec.2020
       ============================================ */

    /**
     * ColorSpaceConverter - Provides conversions between different color spaces
     * including sRGB, Rec.709, Rec.2020, and linear RGB. Uses standard
     * transformation matrices defined by ITU-R recommendations.
     */
    class ColorSpaceConverter {
        constructor() {
            // Transformation matrices (row-major)
            // Rec.709 to Rec.2020 matrix (ITU-R BT.2087)
            this._rec709to2020 = [
                [0.627402, 0.329292, 0.043306],
                [0.069095, 0.919544, 0.011360],
                [0.016394, 0.088028, 0.895578]
            ];
            // Rec.2020 to Rec.709 matrix (inverse)
            this._rec2020to709 = [
                [1.660496, -0.587656, -0.072840],
                [-0.124547, 1.132895, -0.008348],
                [-0.018154, -0.100570, 1.118724]
            ];
        }

        /**
         * Apply sRGB gamma decoding (linearize sRGB values).
         * @param {number} v - sRGB value in [0, 1].
         * @returns {number} Linear light value.
         */
        sRGBToLinear(v) {
            if (v <= 0.04045) return v / 12.92;
            return Math.pow((v + 0.055) / 1.055, 2.4);
        }

        /**
         * Apply sRGB gamma encoding (compress linear to sRGB).
         * @param {number} v - Linear value in [0, 1].
         * @returns {number} sRGB encoded value.
         */
        linearToSRGB(v) {
            if (v <= 0.0031308) return v * 12.92;
            return 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
        }

        /**
         * Apply Rec.2020 gamma decoding (linearize).
         * Uses the 12-bit precision transfer function.
         * @param {number} v - Rec.2020 value in [0, 1].
         * @returns {number} Linear light value.
         */
        rec2020ToLinear(v) {
            const alpha = 1.09929682680944;
            const beta = 0.018053968510807;
            if (v < beta * 4.5) return v / 4.5;
            return Math.pow((v + (alpha - 1)) / alpha, 1.0 / 0.45);
        }

        /**
         * Apply Rec.2020 gamma encoding.
         * @param {number} v - Linear value in [0, 1].
         * @returns {number} Rec.2020 encoded value.
         */
        linearToRec2020(v) {
            const alpha = 1.09929682680944;
            if (v < 0.018053968510807) return 4.5 * v;
            return alpha * Math.pow(v, 0.45) - (alpha - 1);
        }

        /**
         * Apply a 3x3 matrix transformation to an RGB color.
         * @param {number[]} rgb - Input [R, G, B] in [0, 1].
         * @param {number[][]} matrix - 3x3 transformation matrix.
         * @returns {number[]} Transformed [R, G, B] in [0, 1].
         */
        applyMatrix(rgb, matrix) {
            return [
                matrix[0][0] * rgb[0] + matrix[0][1] * rgb[1] + matrix[0][2] * rgb[2],
                matrix[1][0] * rgb[0] + matrix[1][1] * rgb[1] + matrix[1][2] * rgb[2],
                matrix[2][0] * rgb[0] + matrix[2][1] * rgb[1] + matrix[2][2] * rgb[2]
            ];
        }

        /**
         * Convert ImageData from one color space to another.
         * @param {ImageData} imageData - Input image data (assumed source color space).
         * @param {string} from - Source color space: 'srgb', 'rec709', 'rec2020'.
         * @param {string} to - Target color space: 'srgb', 'rec709', 'rec2020'.
         * @returns {ImageData} Converted image data.
         */
        convertImage(imageData, from, to) {
            if (from === to) return imageData;
            const w = imageData.width;
            const h = imageData.height;
            const src = imageData.data;
            const output = new ImageData(w, h);
            const dst = output.data;

            for (let i = 0; i < src.length; i += 4) {
                // Normalize to [0, 1]
                let rgb = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];

                // Step 1: Decode from source to linear
                if (from === 'srgb' || from === 'rec709') {
                    rgb = rgb.map(c => this.sRGBToLinear(c));
                } else if (from === 'rec2020') {
                    rgb = rgb.map(c => this.rec2020ToLinear(c));
                }

                // Step 2: Apply matrix transform if needed
                if (from === 'rec709' && to === 'rec2020') {
                    rgb = this.applyMatrix(rgb, this._rec709to2020);
                } else if (from === 'rec2020' && (to === 'rec709' || to === 'srgb')) {
                    rgb = this.applyMatrix(rgb, this._rec2020to709);
                }
                // sRGB and Rec.709 share the same primaries, no matrix needed between them

                // Step 3: Encode from linear to target
                if (to === 'srgb' || to === 'rec709') {
                    rgb = rgb.map(c => Math.max(0, Math.min(1, this.linearToSRGB(c))));
                } else if (to === 'rec2020') {
                    rgb = rgb.map(c => Math.max(0, Math.min(1, this.linearToRec2020(c))));
                }

                dst[i] = Math.round(rgb[0] * 255);
                dst[i + 1] = Math.round(rgb[1] * 255);
                dst[i + 2] = Math.round(rgb[2] * 255);
                dst[i + 3] = src[i + 3]; // Preserve alpha
            }
            return output;
        }

        /**
         * Convert a single RGB color from one space to another.
         * @param {number[]} rgb - Input [R, G, B] in [0, 255].
         * @param {string} from - Source color space.
         * @param {string} to - Target color space.
         * @returns {number[]} Converted [R, G, B] in [0, 255].
         */
        convertColor(rgb, from, to) {
            const normalized = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];

            let linear;
            if (from === 'srgb' || from === 'rec709') {
                linear = normalized.map(c => this.sRGBToLinear(c));
            } else if (from === 'rec2020') {
                linear = normalized.map(c => this.rec2020ToLinear(c));
            } else {
                linear = normalized;
            }

            if (from === 'rec709' && to === 'rec2020') {
                linear = this.applyMatrix(linear, this._rec709to2020);
            } else if (from === 'rec2020' && (to === 'rec709' || to === 'srgb')) {
                linear = this.applyMatrix(linear, this._rec2020to709);
            }

            let result;
            if (to === 'srgb' || to === 'rec709') {
                result = linear.map(c => Math.max(0, Math.min(255, Math.round(this.linearToSRGB(c) * 255))));
            } else if (to === 'rec2020') {
                result = linear.map(c => Math.max(0, Math.min(255, Math.round(this.linearToRec2020(c) * 255))));
            } else {
                result = linear.map(c => Math.round(c * 255));
            }
            return result;
        }
    }

    /* ============================================
       FEATURE 8: Image Sequence Playback
       Support playing image sequences as video
       ============================================ */

    /**
     * ImageSequencePlayer - Plays a sequence of images as if they were a video.
     * Supports variable frame rates, looping, and frame caching for smooth playback.
     */
    class ImageSequencePlayer {
        constructor() {
            /** @type {string[]} Array of image URLs or data URIs in sequence order */
            this._frames = [];
            /** @type {HTMLImageElement[]} Cached (preloaded) Image objects */
            this._cachedImages = [];
            /** @type {number} Current frame index */
            this._currentFrame = 0;
            /** @type {number} Frames per second */
            this._fps = 24;
            /** @type {boolean} Whether the sequence is currently playing */
            this._playing = false;
            /** @type {number} RAF ID for the playback loop */
            this._rafId = null;
            /** @type {number} Timestamp of the last frame advance */
            this._lastFrameTime = 0;
            /** @type {boolean} Loop the sequence */
            this._loop = true;
            /** @type {Function|null} Callback invoked on each frame change */
            this._onFrame = null;
        }

        /**
         * Load an image sequence from an array of URLs.
         * @param {string[]} urls - Array of image URLs in playback order.
         * @param {number} fps - Frames per second for playback.
         * @param {Function} [onFrame] - Callback(frameIndex, imageElement) per frame.
         * @returns {Promise<number>} Number of frames successfully loaded.
         */
        async load(urls, fps, onFrame) {
            this._frames = urls;
            this._fps = fps || 24;
            this._onFrame = onFrame || null;
            this._cachedImages = [];
            this._currentFrame = 0;

            let loaded = 0;
            const promises = urls.map((url, index) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        this._cachedImages[index] = img;
                        loaded++;
                        resolve();
                    };
                    img.onerror = () => {
                        console.warn(`ImageSequencePlayer: Failed to load frame ${index}: ${url}`);
                        this._cachedImages[index] = null;
                        resolve();
                    };
                    img.src = url;
                });
            });

            await Promise.all(promises);
            return loaded;
        }

        /**
         * Start playback from the current frame position.
         */
        play() {
            if (this._playing) return;
            this._playing = true;
            this._lastFrameTime = performance.now();
            this._playbackLoop();
        }

        /**
         * Pause playback at the current frame.
         */
        pause() {
            this._playing = false;
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
        }

        /**
         * Stop playback and reset to the first frame.
         */
        stop() {
            this.pause();
            this._currentFrame = 0;
            this._notifyFrame();
        }

        /**
         * Seek to a specific frame by index.
         * @param {number} frameIndex - Zero-based frame index.
         */
        seekToFrame(frameIndex) {
            this._currentFrame = Math.max(0, Math.min(this._frames.length - 1, frameIndex));
            this._notifyFrame();
        }

        /**
         * Seek to a specific time position.
         * @param {number} timeSeconds - Time in seconds.
         */
        seekToTime(timeSeconds) {
            const frameIndex = Math.round(timeSeconds * this._fps);
            this.seekToFrame(frameIndex);
        }

        /**
         * Get the current frame's Image element for rendering.
         * @returns {HTMLImageElement|null}
         */
        getCurrentFrameImage() {
            return this._cachedImages[this._currentFrame] || null;
        }

        /**
         * Get the total duration of the sequence in seconds.
         * @returns {number}
         */
        getDuration() {
            return this._frames.length / this._fps;
        }

        /**
         * Get the total number of frames.
         * @returns {number}
         */
        getFrameCount() {
            return this._frames.length;
        }

        /**
         * Get the current frame index.
         * @returns {number}
         */
        getCurrentFrameIndex() {
            return this._currentFrame;
        }

        /**
         * Render the current frame to a canvas context.
         * @param {CanvasRenderingContext2D} ctx - Target canvas context.
         * @param {number} x - X position.
         * @param {number} y - Y position.
         * @param {number} width - Draw width.
         * @param {number} height - Draw height.
         */
        renderFrame(ctx, x, y, width, height) {
            const img = this.getCurrentFrameImage();
            if (img) {
                ctx.drawImage(img, x, y, width, height);
            }
        }

        /** @private Internal playback loop */
        _playbackLoop() {
            if (!this._playing) return;
            const now = performance.now();
            const elapsed = now - this._lastFrameTime;
            const frameDuration = 1000 / this._fps;

            if (elapsed >= frameDuration) {
                this._lastFrameTime = now - (elapsed % frameDuration);
                this._currentFrame++;
                if (this._currentFrame >= this._frames.length) {
                    if (this._loop) {
                        this._currentFrame = 0;
                    } else {
                        this._currentFrame = this._frames.length - 1;
                        this._playing = false;
                        this._notifyFrame();
                        return;
                    }
                }
                this._notifyFrame();
            }

            this._rafId = requestAnimationFrame(() => this._playbackLoop());
        }

        /** @private Notify the onFrame callback */
        _notifyFrame() {
            if (this._onFrame) {
                this._onFrame(this._currentFrame, this.getCurrentFrameImage());
            }
        }

        /**
         * Destroy the player and release resources.
         */
        destroy() {
            this.pause();
            this._frames = [];
            this._cachedImages = [];
            this._onFrame = null;
        }
    }

    /* ============================================
       FEATURE 9: Subtitle Rendering
       Render SRT/ASS/VTT subtitles on canvas
       ============================================ */

    /**
     * SubtitleRenderer - Parses and renders subtitle files (SRT, WebVTT, ASS)
     * onto a canvas context. Supports styling, positioning, and timing.
     */
    class SubtitleRenderer {
        constructor() {
            /** @type {Array} Sorted list of subtitle cues: { startTime, endTime, text, style } */
            this._cues = [];
            /** @type {Object} Default text styling */
            this._defaultStyle = {
                fontFamily: 'Arial, sans-serif',
                fontSize: 36,
                fontColor: '#ffffff',
                fontWeight: 'bold',
                backgroundColor: 'rgba(0,0,0,0.7)',
                outlineColor: '#000000',
                outlineWidth: 2,
                alignment: 'bottom-center',
                verticalMargin: 40,
                horizontalMargin: 60,
                lineHeight: 1.4
            };
        }

        /**
         * Parse an SRT subtitle string into cues.
         * @param {string} srtContent - The SRT file content.
         * @returns {number} Number of cues parsed.
         */
        parseSRT(srtContent) {
            const cues = [];
            const blocks = srtContent.trim().split(/\n\s*\n/);

            blocks.forEach(block => {
                const lines = block.trim().split('\n');
                if (lines.length < 3) return;

                // Find the timestamp line (line index 1 typically)
                let timeLineIndex = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes('-->')) {
                        timeLineIndex = i;
                        break;
                    }
                }
                if (timeLineIndex === -1) return;

                const timeMatch = lines[timeLineIndex].match(
                    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
                );
                if (!timeMatch) return;

                const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 +
                    parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
                const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 +
                    parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;

                const text = lines.slice(timeLineIndex + 1).join('\n');
                cues.push({ startTime, endTime, text, style: { ...this._defaultStyle } });
            });

            this._cues = cues.sort((a, b) => a.startTime - b.startTime);
            return cues.length;
        }

        /**
         * Parse a WebVTT subtitle string into cues.
         * @param {string} vttContent - The WebVTT file content.
         * @returns {number} Number of cues parsed.
         */
        parseVTT(vttContent) {
            const cues = [];
            // Remove WEBVTT header
            const body = vttContent.replace(/^WEBVTT[^\n]*\n/, '');
            const blocks = body.trim().split(/\n\s*\n/);

            blocks.forEach(block => {
                const lines = block.trim().split('\n');
                let timeLineIndex = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes('-->')) {
                        timeLineIndex = i;
                        break;
                    }
                }
                if (timeLineIndex === -1) return;

                const timeMatch = lines[timeLineIndex].match(
                    /(\d{2}):(\d{2}):(\d{2})[.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.](\d{3})/
                );
                if (!timeMatch) {
                    // Try MM:SS.mmm format
                    const shortMatch = lines[timeLineIndex].match(
                        /(\d{2}):(\d{2})[.](\d{3})\s*-->\s*(\d{2}):(\d{2})[.](\d{3})/
                    );
                    if (!shortMatch) return;
                    const startTime = parseInt(shortMatch[1]) * 60 + parseInt(shortMatch[2]) + parseInt(shortMatch[3]) / 1000;
                    const endTime = parseInt(shortMatch[4]) * 60 + parseInt(shortMatch[5]) + parseInt(shortMatch[6]) / 1000;
                    const text = lines.slice(timeLineIndex + 1).join('\n');
                    cues.push({ startTime, endTime, text, style: { ...this._defaultStyle } });
                    return;
                }

                const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 +
                    parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
                const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 +
                    parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
                const text = lines.slice(timeLineIndex + 1).join('\n');
                cues.push({ startTime, endTime, text, style: { ...this._defaultStyle } });
            });

            this._cues = cues.sort((a, b) => a.startTime - b.startTime);
            return cues.length;
        }

        /**
         * Parse an ASS (Advanced SubStation Alpha) subtitle string into cues.
         * Supports basic ASS styling properties.
         * @param {string} assContent - The ASS file content.
         * @returns {number} Number of cues parsed.
         */
        parseASS(assContent) {
            const cues = [];
            const lines = assContent.split('\n');
            let inEvents = false;
            let formatFields = [];

            for (const line of lines) {
                const trimmed = line.trim();

                if (trimmed.startsWith('[Events]')) {
                    inEvents = true;
                    continue;
                }
                if (trimmed.startsWith('[')) {
                    inEvents = false;
                    continue;
                }

                if (inEvents) {
                    if (trimmed.startsWith('Format:')) {
                        formatFields = trimmed.substring(7).split(',').map(f => f.trim());
                    } else if (trimmed.startsWith('Dialogue:')) {
                        const dialogueLine = trimmed.substring(9);
                        // Split only up to the number of format fields (text may contain commas)
                        const parts = dialogueLine.split(',', formatFields.length - 1);
                        if (parts.length < formatFields.length) continue;

                        const fields = {};
                        formatFields.forEach((name, i) => {
                            fields[name] = parts[i] ? parts[i].trim() : '';
                        });

                        const startSec = this._parseASSTime(fields.Start || '0:00:00.00');
                        const endSec = this._parseASSTime(fields.End || '0:00:00.00');
                        // Remove ASS override tags for basic rendering
                        const cleanText = (fields.Text || '').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n');

                        cues.push({
                            startTime: startSec,
                            endTime: endSec,
                            text: cleanText,
                            style: { ...this._defaultStyle }
                        });
                    }
                }
            }

            this._cues = cues.sort((a, b) => a.startTime - b.startTime);
            return cues.length;
        }

        /**
         * @private Parse ASS timestamp (H:MM:SS.CC) to seconds.
         */
        _parseASSTime(timeStr) {
            const parts = timeStr.split(':');
            if (parts.length !== 3) return 0;
            const h = parseInt(parts[0]) || 0;
            const m = parseInt(parts[1]) || 0;
            const s = parseFloat(parts[2]) || 0;
            return h * 3600 + m * 60 + s;
        }

        /**
         * Render active subtitle cues for the given time onto a canvas.
         * @param {CanvasRenderingContext2D} ctx - Target canvas context.
         * @param {number} time - Current playback time in seconds.
         * @param {number} canvasWidth - Canvas width.
         * @param {number} canvasHeight - Canvas height.
         * @param {Object} [overrideStyle] - Optional style overrides.
         */
        render(ctx, time, canvasWidth, canvasHeight, overrideStyle) {
            const activeCues = this._cues.filter(cue => time >= cue.startTime && time <= cue.endTime);

            activeCues.forEach(cue => {
                const style = overrideStyle ? { ...cue.style, ...overrideStyle } : cue.style;
                this._renderCue(ctx, cue, style, canvasWidth, canvasHeight);
            });
        }

        /**
         * @private Render a single subtitle cue.
         */
        _renderCue(ctx, cue, style, cw, ch) {
            const lines = cue.text.split('\n');
            const fontSize = style.fontSize || 36;
            const lineHeight = fontSize * (style.lineHeight || 1.4);

            ctx.save();
            ctx.font = `${style.fontWeight || 'bold'} ${fontSize}px ${style.fontFamily || 'Arial'}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Calculate total text block dimensions
            let maxWidth = 0;
            lines.forEach(line => {
                const m = ctx.measureText(line);
                if (m.width > maxWidth) maxWidth = m.width;
            });
            const totalHeight = lines.length * lineHeight;
            const padding = 8;
            const bgWidth = maxWidth + padding * 2;
            const bgHeight = totalHeight + padding * 2;

            // Position based on alignment
            let x, y;
            switch (style.alignment) {
                case 'top-center':
                    x = cw / 2; y = style.verticalMargin || 40; break;
                case 'center':
                    x = cw / 2; y = (ch - totalHeight) / 2; break;
                case 'bottom-center':
                default:
                    x = cw / 2; y = ch - totalHeight - (style.verticalMargin || 40); break;
            }

            // Draw background
            if (style.backgroundColor && style.backgroundColor !== 'transparent') {
                ctx.fillStyle = style.backgroundColor;
                ctx.fillRect(x - bgWidth / 2, y - padding, bgWidth, bgHeight);
            }

            // Draw outline (stroke text)
            if (style.outlineWidth > 0) {
                ctx.strokeStyle = style.outlineColor || '#000000';
                ctx.lineWidth = style.outlineWidth * 2;
                ctx.lineJoin = 'round';
                lines.forEach((line, i) => {
                    ctx.strokeText(line, x, y + i * lineHeight);
                });
            }

            // Draw text fill
            ctx.fillStyle = style.fontColor || '#ffffff';
            lines.forEach((line, i) => {
                ctx.fillText(line, x, y + i * lineHeight);
            });

            ctx.restore();
        }

        /**
         * Get all cues that are active at a given time.
         * @param {number} time - Time in seconds.
         * @returns {Array} Active cue objects.
         */
        getActiveCues(time) {
            return this._cues.filter(cue => time >= cue.startTime && time <= cue.endTime);
        }

        /**
         * Clear all loaded cues.
         */
        clear() {
            this._cues = [];
        }
    }

    /* ============================================
       FEATURE 10: Safe Area Guides
       Multiple safe area presets (broadcast, social media)
       ============================================ */

    /**
     * SafeAreaGuide - Renders safe area guides on a canvas for various
     * broadcast and social media delivery targets. Supports action safe,
     * title safe, and custom safe area definitions.
     */
    class SafeAreaGuide {
        constructor() {
            /** @type {boolean} Whether guides are currently visible */
            this.visible = false;
            /** @type {string} Current preset name */
            this.currentPreset = 'broadcast-hd';
            /** @type {Object} Guide rendering style */
            this.style = {
                lineColor: 'rgba(255, 255, 255, 0.5)',
                lineWidth: 1,
                labelColor: 'rgba(255, 255, 255, 0.6)',
                labelFont: '10px monospace',
                dashPattern: [5, 5]
            };
            // Preset definitions: each defines safe areas as percentages of canvas
            this._presets = {
                'broadcast-hd': {
                    name: 'Broadcast HD (ITU-R BT.1848)',
                    areas: [
                        { id: 'action-safe', label: 'Action Safe (93%)', top: 3.5, bottom: 3.5, left: 3.5, right: 3.5 },
                        { id: 'title-safe', label: 'Title Safe (90%)', top: 5, bottom: 5, left: 5, right: 5 },
                        { id: 'graphics-safe', label: 'Graphics Safe (80%)', top: 10, bottom: 10, left: 10, right: 10 }
                    ]
                },
                'broadcast-sd': {
                    name: 'Broadcast SD',
                    areas: [
                        { id: 'action-safe', label: 'Action Safe (90%)', top: 5, bottom: 5, left: 5, right: 5 },
                        { id: 'title-safe', label: 'Title Safe (80%)', top: 10, bottom: 10, left: 10, right: 10 }
                    ]
                },
                'social-instagram': {
                    name: 'Instagram (4:5)',
                    areas: [
                        { id: 'safe-area', label: 'Instagram Safe', top: 8, bottom: 12, left: 5, right: 5 }
                    ]
                },
                'social-tiktok': {
                    name: 'TikTok (9:16)',
                    areas: [
                        { id: 'safe-area', label: 'TikTok Safe', top: 10, bottom: 15, left: 5, right: 5 }
                    ]
                },
                'social-youtube': {
                    name: 'YouTube (16:9)',
                    areas: [
                        { id: 'safe-area', label: 'YouTube Safe', top: 5, bottom: 10, left: 5, right: 5 }
                    ]
                },
                'social-twitter': {
                    name: 'Twitter/X',
                    areas: [
                        { id: 'safe-area', label: 'Twitter Safe', top: 8, bottom: 10, left: 5, right: 5 }
                    ]
                },
                'film-2.39': {
                    name: 'Film (2.39:1)',
                    areas: [
                        { id: 'action-safe', label: 'Action Safe', top: 3.5, bottom: 3.5, left: 3.5, right: 3.5 },
                        { id: 'title-safe', label: 'Title Safe', top: 5, bottom: 5, left: 5, right: 5 }
                    ]
                },
                'custom': {
                    name: 'Custom',
                    areas: [
                        { id: 'action-safe', label: 'Custom Safe', top: 5, bottom: 5, left: 5, right: 5 }
                    ]
                }
            };
        }

        /**
         * Get a list of all available preset names and their display names.
         * @returns {Array<{id: string, name: string}>}
         */
        getPresets() {
            return Object.entries(this._presets).map(([id, preset]) => ({
                id,
                name: preset.name
            }));
        }

        /**
         * Set the current safe area preset.
         * @param {string} presetId - The preset identifier.
         */
        setPreset(presetId) {
            if (this._presets[presetId]) {
                this.currentPreset = presetId;
            }
        }

        /**
         * Add or update a custom safe area preset.
         * @param {string} id - Preset identifier.
         * @param {string} name - Display name.
         * @param {Array} areas - Array of safe area definitions.
         */
        addPreset(id, name, areas) {
            this._presets[id] = { name, areas };
        }

        /**
         * Update the custom preset with user-defined safe areas.
         * @param {Array} areas - Array of {id, label, top, bottom, left, right} in percent.
         */
        setCustomAreas(areas) {
            this._presets['custom'].areas = areas;
        }

        /**
         * Render safe area guides onto a canvas context.
         * @param {CanvasRenderingContext2D} ctx - Target canvas context.
         * @param {number} width - Canvas width.
         * @param {number} height - Canvas height.
         */
        render(ctx, width, height) {
            if (!this.visible) return;

            const preset = this._presets[this.currentPreset];
            if (!preset) return;

            ctx.save();

            preset.areas.forEach(area => {
                const top = (area.top / 100) * height;
                const bottom = ((100 - area.bottom) / 100) * height;
                const left = (area.left / 100) * width;
                const right = ((100 - area.right) / 100) * width;
                const rectW = right - left;
                const rectH = bottom - top;

                // Draw dashed rectangle
                ctx.strokeStyle = this.style.lineColor;
                ctx.lineWidth = this.style.lineWidth;
                ctx.setLineDash(this.style.dashPattern);
                ctx.strokeRect(left, top, rectW, rectH);

                // Draw corner markers (small L-shapes at each corner)
                const markerLen = 20;
                ctx.setLineDash([]);
                ctx.lineWidth = 1.5;

                // Top-left
                ctx.beginPath();
                ctx.moveTo(left, top + markerLen); ctx.lineTo(left, top); ctx.lineTo(left + markerLen, top);
                ctx.stroke();
                // Top-right
                ctx.beginPath();
                ctx.moveTo(right - markerLen, top); ctx.lineTo(right, top); ctx.lineTo(right, top + markerLen);
                ctx.stroke();
                // Bottom-left
                ctx.beginPath();
                ctx.moveTo(left, bottom - markerLen); ctx.lineTo(left, bottom); ctx.lineTo(left + markerLen, bottom);
                ctx.stroke();
                // Bottom-right
                ctx.beginPath();
                ctx.moveTo(right - markerLen, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, bottom - markerLen);
                ctx.stroke();

                // Label
                ctx.fillStyle = this.style.labelColor;
                ctx.font = this.style.labelFont;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(area.label, left + 4, top + 4);
            });

            // Draw center crosshair
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height);
            ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.restore();
        }

        /**
         * Toggle guide visibility.
         * @returns {boolean} New visibility state.
         */
        toggle() {
            this.visible = !this.visible;
            return this.visible;
        }
    }

    // Expose new classes on the player namespace for external access
    window.zcutPlayer.CompositingManager = CompositingManager;
    window.zcutPlayer.VideoDecodePipeline = VideoDecodePipeline;
    window.zcutPlayer.AudioVisualizer = AudioVisualizer;
    window.zcutPlayer.MultiLayerRenderer = MultiLayerRenderer;
    window.zcutPlayer.GPUEffectsProcessor = GPUEffectsProcessor;
    window.zcutPlayer.FrameInterpolator = FrameInterpolator;
    window.zcutPlayer.ColorSpaceConverter = ColorSpaceConverter;
    window.zcutPlayer.ImageSequencePlayer = ImageSequencePlayer;
    window.zcutPlayer.SubtitleRenderer = SubtitleRenderer;
    window.zcutPlayer.SafeAreaGuide = SafeAreaGuide;
})();
