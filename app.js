/* ===================================================
   app.js - 去水印工具主逻辑
   负责：文件上传、画笔涂抹、UI 交互、前后对比
   =================================================== */

(function () {
    'use strict';

    // ========== DOM 元素引用 ==========
    const uploadZone    = document.getElementById('uploadZone');
    const editorZone    = document.getElementById('editorZone');
    const fileInput     = document.getElementById('fileInput');
    const btnSelectFile = document.getElementById('btnSelectFile');

    const mainCanvas    = document.getElementById('mainCanvas');
    const maskCanvas    = document.getElementById('maskCanvas');
    const ctx           = mainCanvas.getContext('2d');
    const mctx          = maskCanvas.getContext('2d');

    // 控制面板按钮
    const btnClearMask = document.getElementById('btnClearMask');
    const btnUndo      = document.getElementById('btnUndo');
    const btnProcess   = document.getElementById('btnProcess');
    const btnCompare   = document.getElementById('btnCompare');
    const btnDownload  = document.getElementById('btnDownload');
    const btnReset     = document.getElementById('btnReset');

    // 画笔控件
    const brushSizeInput = document.getElementById('brushSize');
    const brushDot       = document.getElementById('brushDot');
    const brushLabel     = document.getElementById('brushLabel');

    // 修复参数
    const radiusInput    = document.getElementById('inpaintRadius');
    const radiusLabel    = document.getElementById('radiusLabel');
    const toggleBtns     = document.querySelectorAll('.toggle-btn[data-method]');

    // 进度弹窗
    const progressOverlay = document.getElementById('progressOverlay');
    const progressBar     = document.getElementById('progressBar');
    const progressText    = document.getElementById('progressText');

    // 对比滑块
    const compareSlider   = document.getElementById('compareSlider');
    const compareLine     = document.getElementById('compareLine');
    const originalCanvas  = document.getElementById('originalCanvas');
    const origCtx         = originalCanvas.getContext('2d');

    // 状态徽章
    const badgeHint = document.getElementById('badgeHint');
    const badgeDone = document.getElementById('badgeDone');

    // ========== 应用状态 ==========
    let imageLoaded = false;
    let isDrawing = false;
    let lastX = 0, lastY = 0;
    let scaleX = 1, scaleY = 1;
    let maskSnapshots = [];          // 撤销历史
    let originalImageData = null;    // 原图备份（用于多次修复和对比）
    let inpaintMethod = 'telea';     // 当前算法
    let isComparing = false;         // 是否在对比模式

    // ========== 文件上传 ==========

    /** 拖拽上传支持 */
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('drag-over');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadImage(file);
    });

    /** 点击上传 */
    uploadZone.addEventListener('click', (e) => {
        // 避免按钮点击时重复触发
        if (e.target.closest('.btn')) return;
        fileInput.click();
    });

    btnSelectFile.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) loadImage(e.target.files[0]);
    });

    /** 加载图片到 canvas */
    function loadImage(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                // 限制最大尺寸（保证性能）
                const MAX = 1600;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    const ratio = Math.min(MAX / w, MAX / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }

                // 设置所有 canvas 尺寸
                mainCanvas.width = w;
                mainCanvas.height = h;
                maskCanvas.width = w;
                maskCanvas.height = h;
                originalCanvas.width = w;
                originalCanvas.height = h;

                // 绘制图片
                ctx.drawImage(img, 0, 0, w, h);
                mctx.clearRect(0, 0, w, h);

                // 保存原图备份
                originalImageData = ctx.getImageData(0, 0, w, h);
                origCtx.putImageData(originalImageData, 0, 0);

                // 更新状态
                imageLoaded = true;
                maskSnapshots = [];
                isComparing = false;

                // 切换界面
                uploadZone.classList.add('hidden');
                editorZone.classList.remove('hidden');
                btnDownload.classList.add('hidden');
                btnCompare.classList.add('hidden');
                compareSlider.classList.add('hidden');
                badgeHint.classList.remove('hidden');
                badgeDone.classList.add('hidden');

                // 计算缩放比
                updateScale();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ========== 缩放比计算 ==========

    function updateScale() {
        if (!imageLoaded) return;
        const rect = mainCanvas.getBoundingClientRect();
        const containerRect = mainCanvas.parentElement.getBoundingClientRect();
        scaleX = mainCanvas.width / rect.width;
        scaleY = mainCanvas.height / rect.height;

        // 同步 mask canvas 的显示位置和尺寸，使其精确覆盖在 mainCanvas 上
        // （mainCanvas 可能被 flexbox 居中，与容器左上角有偏移）
        maskCanvas.style.width = rect.width + 'px';
        maskCanvas.style.height = rect.height + 'px';
        maskCanvas.style.left = (rect.left - containerRect.left) + 'px';
        maskCanvas.style.top = (rect.top - containerRect.top) + 'px';
    }

    window.addEventListener('resize', updateScale);

    // 延迟初次计算，确保 DOM 排版完成
    const resizeObserver = new ResizeObserver(() => updateScale());

    // ========== 画笔大小控制 ==========

    brushSizeInput.addEventListener('input', () => {
        const s = parseInt(brushSizeInput.value);
        const displaySize = Math.min(s, 60);
        brushDot.style.width = displaySize + 'px';
        brushDot.style.height = displaySize + 'px';
        brushLabel.textContent = s + 'px';
    });

    // ========== 修复参数控制 ==========

    /** 算法切换 */
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            inpaintMethod = btn.dataset.method;
        });
    });

    /** 修复半径 */
    radiusInput.addEventListener('input', () => {
        radiusLabel.textContent = radiusInput.value;
    });

    // ========== 鼠标 / 触摸绘制遮罩 ==========

    /** 获取相对 canvas 的坐标（考虑缩放） */
    function getPos(e) {
        const rect = mainCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    /** 获取画笔半径（考虑缩放） */
    function getBrushRadius() {
        return parseInt(brushSizeInput.value) / 2 * scaleX;
    }

    // 鼠标事件
    mainCanvas.addEventListener('mousedown', startDraw);
    mainCanvas.addEventListener('mousemove', drawStroke);
    mainCanvas.addEventListener('mouseup', endDraw);
    mainCanvas.addEventListener('mouseleave', endDraw);

    // 触摸事件
    mainCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); }, { passive: false });
    mainCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); drawStroke(e); }, { passive: false });
    mainCanvas.addEventListener('touchend', endDraw);

    function startDraw(e) {
        if (!imageLoaded || isComparing) return;

        // 退出对比模式
        exitCompareMode();

        // 保存撤销快照
        maskSnapshots.push(mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
        if (maskSnapshots.length > 30) maskSnapshots.shift();

        isDrawing = true;
        const { x, y } = getPos(e);
        lastX = x;
        lastY = y;
        paintMask(x, y);
    }

    function drawStroke(e) {
        if (!isDrawing) return;
        const { x, y } = getPos(e);

        // 插值绘制，让笔迹连续
        const dist = Math.hypot(x - lastX, y - lastY);
        const steps = Math.max(1, Math.ceil(dist / 3));
        for (let i = 1; i <= steps; i++) {
            const tx = lastX + (x - lastX) * i / steps;
            const ty = lastY + (y - lastY) * i / steps;
            paintMask(tx, ty);
        }
        lastX = x;
        lastY = y;
    }

    function endDraw() {
        isDrawing = false;
    }

    /** 在 maskCanvas 上绘制红色圆形遮罩 */
    function paintMask(x, y) {
        const r = getBrushRadius();
        mctx.globalCompositeOperation = 'source-over';
        mctx.fillStyle = 'rgba(139, 92, 246, 0.85)';  // 紫色遮罩
        mctx.beginPath();
        mctx.arc(x, y, r, 0, Math.PI * 2);
        mctx.fill();
    }

    // ========== 操作按钮 ==========

    /** 撤销上一步涂抹 */
    btnUndo.addEventListener('click', () => {
        if (maskSnapshots.length === 0) return;
        const prev = maskSnapshots.pop();
        mctx.putImageData(prev, 0, 0);
    });

    /** 清除全部涂抹 */
    btnClearMask.addEventListener('click', () => {
        maskSnapshots.push(mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
        mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    });

    /** 智能去除（调用 OpenCV inpaint） */
    btnProcess.addEventListener('click', async () => {
        // 检查遮罩是否有内容
        const maskData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        let hasMask = false;
        for (let i = 3; i < maskData.data.length; i += 4) {
            if (maskData.data[i] > 10) { hasMask = true; break; }
        }

        if (!hasMask) {
            alert('请先用画笔涂抹水印区域，再点击去除！');
            return;
        }

        if (!cvReady) {
            alert('OpenCV.js 引擎尚未加载完成，请稍等几秒再试！');
            return;
        }

        // 显示进度
        showProgress(0, '准备修复...');

        try {
            await inpaintImage(mainCanvas, maskCanvas, {
                method: inpaintMethod,
                radius: parseInt(radiusInput.value),
                onProgress: showProgress
            });

            // 清除遮罩
            mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskSnapshots = [];

            // 更新 UI
            badgeHint.classList.add('hidden');
            badgeDone.classList.remove('hidden');
            btnDownload.classList.remove('hidden');
            btnCompare.classList.remove('hidden');

            await sleep(300);
            hideProgress();

        } catch (err) {
            hideProgress();
            alert('修复失败：' + err.message);
        }
    });

    /** 保存图片 */
    btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'watermark-removed.png';
        link.href = mainCanvas.toDataURL('image/png');
        link.click();
    });

    /** 重新上传 */
    btnReset.addEventListener('click', () => {
        imageLoaded = false;
        isComparing = false;
        maskSnapshots = [];
        originalImageData = null;
        ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
        mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        fileInput.value = '';
        editorZone.classList.add('hidden');
        uploadZone.classList.remove('hidden');
        compareSlider.classList.add('hidden');
    });

    // ========== 前后对比功能 ==========

    btnCompare.addEventListener('click', () => {
        if (isComparing) {
            exitCompareMode();
        } else {
            enterCompareMode();
        }
    });

    function enterCompareMode() {
        if (!originalImageData) return;
        isComparing = true;

        // 显示原图到 originalCanvas 上
        origCtx.putImageData(originalImageData, 0, 0);

        // 同步 originalCanvas 的显示尺寸
        const rect = mainCanvas.getBoundingClientRect();
        originalCanvas.style.width = rect.width + 'px';
        originalCanvas.style.height = rect.height + 'px';

        compareSlider.classList.remove('hidden');
        maskCanvas.style.display = 'none';
        btnCompare.textContent = '退出对比';

        // 初始化滑块位置
        setComparePosition(50);
    }

    function exitCompareMode() {
        isComparing = false;
        compareSlider.classList.add('hidden');
        maskCanvas.style.display = '';
        btnCompare.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.3"/><line x1="8" y1="3" x2="8" y2="13" stroke="currentColor" stroke-width="1.3"/></svg>
            前后对比
        `;
    }

    /** 设置对比滑块位置 (0-100) */
    function setComparePosition(percent) {
        compareLine.style.left = percent + '%';
        // clip-path 控制原图显示范围
        originalCanvas.style.clipPath = `inset(0 0 0 ${percent}%)`;
    }

    // 对比滑块拖拽
    let isDraggingCompare = false;

    compareLine.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDraggingCompare = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingCompare) return;
        const container = document.getElementById('canvasContainer');
        const rect = container.getBoundingClientRect();
        const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        setComparePosition(pct);
    });

    document.addEventListener('mouseup', () => {
        isDraggingCompare = false;
    });

    // 触摸支持
    compareLine.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDraggingCompare = true;
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isDraggingCompare) return;
        const container = document.getElementById('canvasContainer');
        const rect = container.getBoundingClientRect();
        const touch = e.touches[0];
        const pct = Math.max(0, Math.min(100, ((touch.clientX - rect.left) / rect.width) * 100));
        setComparePosition(pct);
    });

    document.addEventListener('touchend', () => {
        isDraggingCompare = false;
    });

    // ========== 进度弹窗控制 ==========

    function showProgress(pct, text) {
        progressOverlay.classList.remove('hidden');
        progressBar.style.width = pct + '%';
        progressText.textContent = text || '';
    }

    function hideProgress() {
        progressOverlay.classList.add('hidden');
        progressBar.style.width = '0%';
    }

})();
