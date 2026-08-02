// ===== QR SCANNER (camera) =====
// Uses the browser's native BarcodeDetector — no decoder library to ship. It's
// available in Chromium-based browsers (notably Chrome on Android, the main place
// someone scans a friend's phone). Where it's absent we degrade gracefully: the
// button says so and the user types the code instead.
import { $, toast, trapFocus, lockScroll, unlockScroll } from './ui.js';
import { registerActions } from './events.js';

let stream = null, rafId = 0, releaseFocus = null, onResult = null, detector = null;

export function scannerSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function openScanner(cb) {
  if (!scannerSupported()) {
    toast("Camera scanning isn't supported on this browser — enter the code instead", 'info');
    return;
  }
  onResult = cb;
  const ov = $('scanOv'); if (!ov) return;
  ov.classList.add('active'); lockScroll();
  releaseFocus = trapFocus(ov, document.activeElement);
  const video = $('scanVideo'), statusEl = $('scanStatus');
  statusEl.textContent = 'Starting camera…';
  try {
    detector = detector || new window.BarcodeDetector({ formats: ['qr_code'] });
    // Prefer the rear camera (you're scanning someone else's screen).
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream;
    await video.play();
    statusEl.textContent = 'Point your camera at a CineVerse QR code';
    scanLoop(video, statusEl);
  } catch (e) {
    console.error('scanner', e);
    statusEl.textContent = e && e.name === 'NotAllowedError'
      ? 'Camera permission denied. Allow it, or enter the code instead.'
      : 'Could not start the camera. Enter the code instead.';
  }
}

async function scanLoop(video, statusEl) {
  if (!stream) return;
  try {
    const codes = await detector.detect(video);
    if (codes && codes.length && codes[0].rawValue) return handleHit(codes[0].rawValue);
  } catch (_) { /* transient decode frame errors are expected */ }
  rafId = requestAnimationFrame(() => scanLoop(video, statusEl));
}

function handleHit(val) {
  const cb = onResult;
  closeScanner();
  if (cb) cb(val);
}

export function closeScanner() {
  const ov = $('scanOv');
  if (!ov || !ov.classList.contains('active')) return;
  cancelAnimationFrame(rafId); rafId = 0;
  if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} }); stream = null; }
  const video = $('scanVideo'); if (video) { try { video.pause(); } catch (_) {} video.srcObject = null; }
  ov.classList.remove('active'); unlockScroll();
  if (releaseFocus) { releaseFocus(); releaseFocus = null; }
  onResult = null;
}

export function isScannerOpen() { const ov = $('scanOv'); return !!ov && ov.classList.contains('active'); }

export function initScan() {
  const ov = $('scanOv');
  if (ov) ov.addEventListener('click', e => { if (e.target === ov) closeScanner(); });
  registerActions({ 'close-scanner': () => closeScanner() });
}
