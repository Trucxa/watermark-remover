/* ===================================================
   inpaint.js - OpenCV.js 图像修复封装
   封装 cv.inpaint() 调用，提供简洁的 API
   =================================================== */

/**
 * OpenCV.js 就绪状态
 * 由 HTML 中的 onload 回调触发
 */
let cvReady = false;

function onOpenCVReady() {
    cvReady = true;
    console.log('[Inpaint] OpenCV.js 加载完成');

    // 隐藏加载遮罩
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('fade-out');
        setTimeout(() => overlay.remove(), 500);
    }
}

/**
 * 执行图像修复（去水印核心函数）
 *
 * @param {HTMLCanvasElement} srcCanvas  - 原始图片的 canvas
 * @param {HTMLCanvasElement} maskCanvas - 遮罩画布（红色区域 = 需要修复）
 * @param {Object} options - 修复选项
 * @param {string} options.method   - 'telea' 或 'ns'（算法选择）
 * @param {number} options.radius   - 修复半径（像素）
 * @param {function} options.onProgress - 进度回调 (percent, text)
 * @returns {Promise<ImageData>} 修复后的 ImageData
 */
async function inpaintImage(srcCanvas, maskCanvas, options = {}) {
    // 检查 OpenCV 是否就绪
    if (!cvReady || typeof cv === 'undefined') {
        throw new Error('OpenCV.js 尚未加载完成，请稍后再试');
    }

    const method = options.method || 'telea';
    const radius = options.radius || 5;
    const onProgress = options.onProgress || (() => {});

    const W = srcCanvas.width;
    const H = srcCanvas.height;

    onProgress(10, '准备图像数据...');
    await sleep(20);

    // ===== 1. 从 canvas 读取图像数据到 OpenCV Mat =====
    let src = null, srcBGR = null, maskMat = null, dst = null, dstRGBA = null;

    try {
        // 读取源图像（RGBA 4 通道）
        src = cv.imread(srcCanvas);

        // cv.inpaint 需要 3 通道 BGR 输入，转换颜色空间
        srcBGR = new cv.Mat();
        cv.cvtColor(src, srcBGR, cv.COLOR_RGBA2BGR);

        onProgress(20, '生成修复遮罩...');
        await sleep(20);

        // ===== 2. 从 maskCanvas 提取二值遮罩 =====
        // maskCanvas 上涂抹的区域是紫色半透明，我们提取 alpha > 30 的像素作为遮罩
        const maskCtx = maskCanvas.getContext('2d');
        const maskData = maskCtx.getImageData(0, 0, W, H);

        // 创建单通道灰度遮罩矩阵
        maskMat = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0));

        // 遍历 maskCanvas 像素，alpha > 30 的设为白色（255 = 需要修复）
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = (y * W + x) * 4;
                if (maskData.data[idx + 3] > 30) {
                    maskMat.ucharPtr(y, x)[0] = 255;
                }
            }
        }

        // ===== 3. 膨胀遮罩 2px，让边缘更干净 =====
        const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
        cv.dilate(maskMat, maskMat, kernel);
        kernel.delete();

        onProgress(40, '执行智能修复...');
        await sleep(20);

        // ===== 4. 执行 inpaint（3 通道 BGR） =====
        dst = new cv.Mat();
        const cvMethod = method === 'telea' ? cv.INPAINT_TELEA : cv.INPAINT_NS;
        cv.inpaint(srcBGR, maskMat, dst, radius, cvMethod);

        onProgress(85, '处理结果...');
        await sleep(20);

        // ===== 5. 转回 RGBA 并写回 canvas =====
        dstRGBA = new cv.Mat();
        cv.cvtColor(dst, dstRGBA, cv.COLOR_BGR2RGBA);
        cv.imshow(srcCanvas, dstRGBA);

        onProgress(100, '修复完成！');

        return true;

    } catch (err) {
        console.error('[Inpaint] 修复失败:', err);
        // OpenCV 的错误可能是字符串，包装成 Error 对象
        throw new Error(typeof err === 'string' ? err : (err.message || '未知错误'));

    } finally {
        // ===== 6. 释放 OpenCV Mat 内存 =====
        if (src) src.delete();
        if (srcBGR) srcBGR.delete();
        if (maskMat) maskMat.delete();
        if (dst) dst.delete();
        if (dstRGBA) dstRGBA.delete();
    }
}

/**
 * 辅助：等待若干毫秒（让浏览器有时间渲染 UI）
 */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
