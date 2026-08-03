// ===== TRAILER + SHARE + IMAGE LIGHTBOX =====
import { toast, $, trapFocus, lockScroll, unlockScroll, esc } from './ui.js';
import { registerActions } from './events.js';
import { IMG } from './config.js';
import { tmdb } from './api.js';

export function playTrailer(key) {
  const frame = $('trailerFrame');
  frame.src = `https://www.youtube.com/embed/${key}?autoplay=1&rel=0&cc_load_policy=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  $('trailerOv').classList.add('active');
}
export function closeTrailer() {
  $('trailerFrame').src = '';
  $('trailerOv').classList.remove('active');
}
export function isTrailerOpen() { return $('trailerOv').classList.contains('active'); }

let shareBlob = null, shareObjectURL = '', shareData = null, shareRelease = null, shareGen = 0;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
}

async function bitmap(path) {
  if (!path) return null;
  try {
    const response = await fetch(`${IMG}original${path}`); if (!response.ok) return null;
    const blob = await response.blob();
    if (window.createImageBitmap) return await createImageBitmap(blob);
    const objectURL = URL.createObjectURL(blob);
    return await new Promise(resolve => {
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(objectURL); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectURL); resolve(null); };
      image.src = objectURL;
    });
  } catch (_) { return null; }
}

function cover(ctx, image, x, y, width, height) {
  if (!image) return;
  const scale = Math.max(width / image.width, height / image.height), sw = width / scale, sh = height / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, width, height);
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || '').split(/\s+/); let line = '', lines = [];
  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  });
  if (line) lines.push(line); lines = lines.slice(0, maxLines);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    while (ctx.measureText(`${lines.at(-1)}…`).width > maxWidth) lines[lines.length - 1] = lines.at(-1).slice(0, -1);
    lines[lines.length - 1] += '…';
  }
  lines.forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
}

async function buildSpoilerCard(detail, type) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1500;
  const ctx = canvas.getContext('2d');
  const [poster, backdrop] = await Promise.all([bitmap(detail.poster_path), bitmap(detail.backdrop_path)]);
  ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (backdrop) { ctx.save(); ctx.globalAlpha = .34; ctx.filter = 'blur(14px)'; cover(ctx, backdrop, -30, -30, 1260, 1560); ctx.restore(); }
  const wash = ctx.createLinearGradient(0, 0, 1200, 1500); wash.addColorStop(0, 'rgba(139,92,246,.3)'); wash.addColorStop(.42, 'rgba(8,8,14,.72)'); wash.addColorStop(1, '#07070c'); ctx.fillStyle = wash; ctx.fillRect(0, 0, 1200, 1500);
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; roundedRect(ctx, 45, 45, 1110, 1410, 42); ctx.stroke();
  ctx.fillStyle = '#ff3342'; ctx.font = '800 29px Arial'; ctx.letterSpacing = '8px'; ctx.fillText('CINEVERSE', 88, 118);
  ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.font = '700 22px Arial'; ctx.fillText('SPOILER-FREE PICK', 880, 116);
  roundedRect(ctx, 88, 175, 555, 832, 32); ctx.save(); ctx.clip(); if (poster) cover(ctx, poster, 88, 175, 555, 832); else { ctx.fillStyle = '#181823'; ctx.fillRect(88, 175, 555, 832); } ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; roundedRect(ctx, 88, 175, 555, 832, 32); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = '800 68px Arial'; const title = detail.title || detail.name || 'Untitled'; wrapCanvasText(ctx, title, 704, 410, 410, 78, 5);
  const year = (detail.release_date || detail.first_air_date || '').slice(0, 4);
  ctx.fillStyle = 'rgba(255,255,255,.67)'; ctx.font = '600 27px Arial'; ctx.fillText(`${type === 'tv' ? 'TV SERIES' : 'MOVIE'}${year ? `  ·  ${year}` : ''}`, 704, 830);
  ctx.fillStyle = '#fbbf24'; ctx.font = '700 24px Arial'; ctx.fillText('NO PLOT  ·  NO RATINGS  ·  NO SPOILERS', 704, 900);
  ctx.fillStyle = 'rgba(255,255,255,.1)'; roundedRect(ctx, 88, 1080, 1024, 220, 30); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.58)'; ctx.font = '600 24px Arial'; ctx.fillText('A title worth sharing.', 132, 1165);
  ctx.fillStyle = '#fff'; ctx.font = '800 35px Arial'; ctx.fillText('Open it on CineVerse', 132, 1225);
  ctx.fillStyle = '#ff3342'; ctx.beginPath(); ctx.arc(1030, 1190, 42, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(1018,1168);ctx.lineTo(1018,1212);ctx.lineTo(1050,1190);ctx.closePath();ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '500 20px Arial'; ctx.fillText('Shared with taste, not spoilers.', 88, 1395);
  poster?.close?.(); backdrop?.close?.();
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png', .94));
}

export async function shareItem(title, id, type) {
  const overlay = $('shareOv'), preview = $('sharePreview'), status = $('shareStudioStatus'), nativeButton = $('shareNativeBtn'); if (!overlay) return;
  if (overlay.classList.contains('active')) closeSpoilerShare();
  shareGen++; const request = shareGen;
  if (shareObjectURL) URL.revokeObjectURL(shareObjectURL); shareObjectURL = ''; shareBlob = null;
  shareData = { title, id, type, url: `${location.origin}/${type}/${id}` };
  overlay.classList.add('active'); lockScroll(); shareRelease = trapFocus(overlay, document.activeElement);
  preview.innerHTML = '<div class="skel"></div>'; if (status) status.textContent = 'Preparing your spoiler-free card…'; if (nativeButton) nativeButton.disabled = true;
  try {
    const detail = await tmdb(`/${type}/${id}`); if (request !== shareGen) return;
    shareData.title = detail.title || detail.name || title;
    const blob = await buildSpoilerCard(detail, type); if (request !== shareGen || !blob) return;
    shareBlob = blob;
    shareObjectURL = URL.createObjectURL(shareBlob);
    preview.innerHTML = `<img src="${shareObjectURL}" alt="Spoiler-free share card for ${esc(shareData.title)}">`;
    if (status) status.textContent = 'Ready to share · No description or ratings included.';
    if (nativeButton) nativeButton.disabled = false;
  } catch (_) { if (status) status.textContent = 'Could not prepare the card. You can still copy the title link.'; }
}

async function nativeSpoilerShare() {
  if (!shareData) return;
  const payload = { title: `CineVerse: ${shareData.title}`, text: 'A spoiler-free pick from CineVerse', url: shareData.url };
  if (shareBlob && window.File) {
    const file = new File([shareBlob], `${shareData.title || 'cineverse-pick'}.png`.replace(/[^\w.-]+/g, '-'), { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) payload.files = [file];
  }
  if (navigator.share) { try { await navigator.share(payload); return; } catch (error) { if (error?.name === 'AbortError') return; } }
  await copySpoilerLink();
}

function downloadSpoilerCard() {
  if (!shareBlob || !shareData) return toast('Card is still being prepared', 'info');
  const link = document.createElement('a'); link.href = shareObjectURL; link.download = `${shareData.title || 'cineverse-pick'}.png`.replace(/[^\w.-]+/g, '-'); link.click();
}

async function copySpoilerLink() {
  if (!shareData) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(shareData.url);
    else {
      const field = document.createElement('textarea'); field.value = shareData.url; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0'; document.body.appendChild(field); field.select();
      const copied = document.execCommand('copy'); field.remove(); if (!copied) throw new Error('copy failed');
    }
    toast('Spoiler-free link copied', 'success');
  }
  catch (_) { toast('Could not copy link', 'error'); }
}

export function closeSpoilerShare() {
  const overlay = $('shareOv'); if (!overlay?.classList.contains('active')) return;
  shareGen++; overlay.classList.remove('active'); unlockScroll(); if (shareRelease) { shareRelease(); shareRelease = null; }
  if (shareObjectURL) URL.revokeObjectURL(shareObjectURL); shareObjectURL = ''; shareBlob = null; shareData = null;
}

export function isSpoilerShareOpen() { return !!$('shareOv')?.classList.contains('active'); }

// ===== IMAGE LIGHTBOX (detail media gallery) =====
// The gallery renders w780/w342 thumbs; full-size `original` is only fetched when
// an image is actually opened.
let lbPaths = [], lbIdx = 0, lbRelease = null;

function paintLB() {
  const img = $('imgStage'), cnt = $('imgCount');
  if (!img || !lbPaths.length) return;
  img.src = `${IMG}original${lbPaths[lbIdx]}`;
  if (cnt) cnt.textContent = `${lbIdx + 1} / ${lbPaths.length}`;
}

export function openLightbox(paths, idx = 0) {
  if (!paths || !paths.length) return;
  const trigger = document.activeElement;
  lbPaths = paths; lbIdx = Math.max(0, Math.min(idx, paths.length - 1));
  paintLB();
  const ov = $('imgOv');
  ov.classList.add('active');
  lockScroll();
  lbRelease = trapFocus(ov, trigger);
  const close = $('imgClose');
  if (close) close.focus();
}

export function closeLightbox() {
  const ov = $('imgOv');
  // Idempotent — closeAllModals() calls this on every navigation, and an
  // unbalanced unlockScroll() would corrupt the lock's reference count.
  if (!ov || !ov.classList.contains('active')) return;
  ov.classList.remove('active');
  const img = $('imgStage');
  if (img) img.src = '';   // stop the download / free the decoded bitmap
  unlockScroll();
  if (lbRelease) { lbRelease(); lbRelease = null; }
  lbPaths = [];
}

export function isLightboxOpen() { return $('imgOv').classList.contains('active'); }

function stepLB(d) {
  if (!lbPaths.length) return;
  lbIdx = (lbIdx + d + lbPaths.length) % lbPaths.length;   // wraps both ways
  paintLB();
}

export function initMedia() {
  // Close when clicking the trailer backdrop (but not the video box).
  const ov = $('trailerOv');
  ov.addEventListener('click', e => { if (e.target === ov) closeTrailer(); });
  // Ask the IFrame API to unload its captions track after each trailer loads.
  // cc_load_policy=0 alone can still follow a viewer's saved YouTube preference.
  const frame = $('trailerFrame');
  if (frame) frame.addEventListener('load', () => {
    if (!frame.src) return;
    const captionsOff = () => {
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setOption', args: ['captions', 'track', {}] }), 'https://www.youtube.com');
        frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }), 'https://www.youtube.com');
      } catch (_) {}
    };
    setTimeout(captionsOff, 350); setTimeout(captionsOff, 1000);
  });

  const iov = $('imgOv');
  if (iov) iov.addEventListener('click', e => { if (e.target === iov) closeLightbox(); });
  const sov = $('shareOv'); if (sov) sov.addEventListener('click', e => { if (e.target === sov) closeSpoilerShare(); });
  // Arrow keys while the lightbox is open. Escape is handled by the router's
  // global handleEscape(), alongside every other modal.
  document.addEventListener('keydown', e => {
    if (!isLightboxOpen()) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stepLB(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLB(-1); }
  });

  registerActions({
    'play-trailer': (el, e) => { e.stopPropagation(); playTrailer(el.dataset.key); },
    'close-trailer': () => closeTrailer(),
    'share-item': (el) => shareItem(el.dataset.title || '', el.dataset.id, el.dataset.type),
    'close-spoiler-share': () => closeSpoilerShare(),
    'share-spoiler-card': () => nativeSpoilerShare(),
    'download-spoiler-card': () => downloadSpoilerCard(),
    'copy-spoiler-link': () => copySpoilerLink(),
    'open-lightbox': (el, e) => {
      e.stopPropagation();
      try { openLightbox(JSON.parse(el.dataset.paths || '[]'), +el.dataset.idx || 0); } catch (_) {}
    },
    'close-lightbox': () => closeLightbox(),
    'lightbox-prev': () => stepLB(-1),
    'lightbox-next': () => stepLB(1),
  });
}
