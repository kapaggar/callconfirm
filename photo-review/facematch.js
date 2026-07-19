// facematch.js — cross-course duplicate detection by face embedding.
//
// BlazeFace (vendor/mediapipe/) only finds face boxes; telling whether two
// faces are the SAME PERSON needs identity embeddings. This module wraps
// face-api.js (vendor/faceapi/, pinned + hashed): TinyFaceDetector → 68-point
// landmarks (alignment) → FaceRecognitionNet 128-d descriptor. Euclidean
// distance between descriptors ≈ identity: <0.6 is the library's "same
// person" convention; we flag in two conservative tiers (see TIERS).
//
// Storage: IndexedDB `vcall_faces` on the dipi origin — descriptors are
// biometric-adjacent data and must NEVER leave the browser. Retention is
// capped at the last KEEP_COURSES indexed courses; photo-review's ♻ Reset
// local wipes the whole DB. A compact per-course match summary (names +
// distances only, no descriptors) goes to localStorage `faceDedup.flags`
// so the course-audit panel can surface the flags.
//
// Loaded on demand by photo-review/review.js (👥 Duplicates). Pure matching
// math is exposed via FaceMatch._internal for the Node test suite.
(function (root) {
  'use strict';

  if (root.FaceMatch) return; // idempotent

  const DB_NAME = 'vcall_faces';
  const DB_VER = 1;
  const FLAGS_KEY = 'faceDedup.flags';
  const KEEP_COURSES = 12;   // same retention as the audit's cross-course cache
  const MAX_FLAGS = 50;      // per-course cap on the localStorage summary
  const TIERS = { strong: 0.45, possible: 0.55 }; // Euclidean distance ceilings

  // ── Pure matching math (unit-tested; no DOM, no face-api) ──

  function dist(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  function tier(d) {
    if (d <= TIERS.strong) return 'strong';
    if (d <= TIERS.possible) return 'possible';
    return null;
  }

  // records: [{ courseKey, aid, name, desc }]. Returns flags for the given
  // course: its records vs every other course's (cross-course duplicates) and
  // vs each other (same face twice in one course under different aids). One
  // flag per (aid, otherAid) pair, keeping the closest distance.
  function matchPairs(records, courseKey) {
    const mine = records.filter(r => r.courseKey === courseKey && r.desc);
    const out = [];
    const seen = new Set();
    for (const r of mine) {
      for (const o of records) {
        if (!o.desc) continue;
        const sameCourse = o.courseKey === courseKey;
        if (sameCourse && o.aid === r.aid) continue; // same record
        if (sameCourse && r.aid > o.aid) continue;   // count each in-course pair once
        const d = dist(r.desc, o.desc);
        const t = tier(d);
        if (!t) continue;
        const key = r.aid + '|' + o.courseKey + '|' + o.aid;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          aid: r.aid, name: r.name,
          otherCourse: o.courseKey, otherAid: o.aid, otherName: o.name,
          dist: Math.round(d * 1000) / 1000, tier: t,
          withinCourse: sameCourse,
        });
      }
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  // Which courseKeys to evict so only the newest `keep` remain. courses:
  // [{ courseKey, ts }] (one entry per course, ts = newest record in it).
  function pruneKeep(courses, keep) {
    return courses
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(keep)
      .map(c => c.courseKey);
  }

  // ── Browser-only from here (IndexedDB + face-api) ──

  const IS_BROWSER = typeof document !== 'undefined' && typeof indexedDB !== 'undefined';

  // Vendor base derives from this script's own URL, so the same file works from
  // the web-hosted copy and the chrome-extension:// copy (like review.js's
  // MP_SELF). Must run synchronously — currentScript is null in callbacks.
  const FA_BASE = (() => {
    if (!IS_BROWSER) return null;
    const cs = document.currentScript;
    return (cs && cs.src) ? new URL('../vendor/faceapi/', cs.src).href : null;
  })();

  let db = null;
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('faces')) {
          const st = d.createObjectStore('faces', { keyPath: 'key' });
          st.createIndex('courseKey', 'courseKey', { unique: false });
        }
      };
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  const tx = (mode, fn) => new Promise((res, rej) => {
    const t = db.transaction('faces', mode);
    const out = fn(t.objectStore('faces'));
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
  const dbGetAll = async () => { await ensureDB(); return new Promise((res, rej) => {
    const r = db.transaction('faces', 'readonly').objectStore('faces').getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  }); };
  async function ensureDB() { if (!db) await openDB(); }

  // ── face-api loading ──
  let loaded = false, loadPromise = null;
  function load() {
    if (loaded) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    if (!FA_BASE) return Promise.resolve(false);
    loadPromise = (async () => {
      if (!root.faceapi) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = FA_BASE + 'face-api.min.js';
          s.onload = res;
          s.onerror = () => rej(new Error('face-api.min.js failed to load'));
          document.head.appendChild(s);
        });
      }
      const fa = root.faceapi;
      await fa.nets.tinyFaceDetector.loadFromUri(FA_BASE);
      await fa.nets.faceLandmark68Net.loadFromUri(FA_BASE);
      await fa.nets.faceRecognitionNet.loadFromUri(FA_BASE);
      loaded = true;
      return true;
    })().catch((e) => { console.warn('[facematch] load failed:', e.message); loadPromise = null; return false; });
    return loadPromise;
  }

  // Draw the canvas centered on a larger white canvas (frac = margin per side
  // as a fraction of each dimension). TinyFaceDetector misses faces that fill
  // the frame (tight passport crops); padding shrinks the face's relative size
  // into the range the detector was trained on. Landmarks + descriptor are
  // computed from the same pixels, so padding doesn't degrade the embedding.
  function padCanvas(src, frac) {
    const mx = Math.round(src.width * frac), my = Math.round(src.height * frac);
    const c = document.createElement('canvas');
    c.width = src.width + 2 * mx;
    c.height = src.height + 2 * my;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, mx, my);
    return c;
  }

  // 128-d descriptor for the (largest) face on a canvas, or null when no face
  // is confidently found. Input should be upright (pass the corrected canvas).
  // Retry ladder: plain canvas first, then a padded copy (rescues zoomed-in
  // close-ups), each at a normal then permissive score threshold. Extra passes
  // only run on photos that would otherwise be skipped, so the common case
  // stays one detection per photo.
  async function describe(canvas) {
    const fa = root.faceapi;
    for (const make of [() => canvas, () => padCanvas(canvas, 0.5)]) {
      const c = make();
      for (const scoreThreshold of [0.3, 0.1]) {
        const opts = new fa.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold });
        const det = await fa.detectSingleFace(c, opts).withFaceLandmarks().withFaceDescriptor();
        if (det) return det.descriptor; // Float32Array(128)
      }
    }
    return null;
  }

  // Index one course: compute + store a descriptor per entry.
  // entries: [{ aid, name, canvas }] — canvas must be the corrected, upright
  // image. Existing rows for the same courseKey|aid are overwritten (re-runs
  // refresh). Returns { indexed, noFace }.
  async function indexCourse(courseKey, entries, onProgress) {
    await ensureDB();
    let indexed = 0, noFace = 0, n = 0;
    for (const e of entries) {
      n++;
      if (onProgress) onProgress(n, entries.length);
      if (!e.aid || !e.canvas) { noFace++; continue; }
      let desc = null;
      try { desc = await describe(e.canvas); } catch (err) { /* count as noFace */ }
      if (!desc) { noFace++; continue; }
      const rec = {
        key: courseKey + '|' + e.aid,
        courseKey, aid: e.aid, name: e.name || '',
        desc: new Float32Array(desc), // structured-clone friendly
        ts: Date.now(),
      };
      await tx('readwrite', (st) => st.put(rec));
      indexed++;
    }
    await pruneOldCourses();
    return { indexed, noFace };
  }

  async function pruneOldCourses() {
    const all = await dbGetAll();
    const byCourse = new Map();
    all.forEach(r => byCourse.set(r.courseKey, Math.max(byCourse.get(r.courseKey) || 0, r.ts || 0)));
    const evict = pruneKeep([...byCourse].map(([courseKey, ts]) => ({ courseKey, ts })), KEEP_COURSES);
    if (!evict.length) return;
    const drop = new Set(evict);
    await tx('readwrite', (st) => {
      all.forEach(r => { if (drop.has(r.courseKey)) st.delete(r.key); });
    });
  }

  // Match the given course against everything stored (including itself).
  async function findMatches(courseKey) {
    const all = await dbGetAll();
    return matchPairs(all, courseKey);
  }

  // Course count + record count, for UI copy.
  async function indexStats() {
    const all = await dbGetAll();
    return { records: all.length, courses: new Set(all.map(r => r.courseKey)).size };
  }

  // Compact summary (no descriptors!) for the audit panel's cross-course view.
  function saveFlags(courseKey, matches) {
    let flags = {};
    try { flags = JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}'); } catch {}
    flags[courseKey] = {
      ts: new Date().toISOString(),
      matches: matches.slice(0, MAX_FLAGS).map(m => ({
        aid: m.aid, name: m.name, otherCourse: m.otherCourse,
        otherAid: m.otherAid, otherName: m.otherName,
        dist: m.dist, tier: m.tier, withinCourse: m.withinCourse,
      })),
    };
    try { localStorage.setItem(FLAGS_KEY, JSON.stringify(flags)); } catch {}
  }

  // Full wipe: descriptors + flag summaries (♻ Reset local calls this).
  async function wipe() {
    try { localStorage.removeItem(FLAGS_KEY); } catch {}
    if (db) { db.close(); db = null; }
    return new Promise((res) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  }

  root.FaceMatch = {
    load, describe, indexCourse, findMatches, indexStats, saveFlags, wipe,
    FLAGS_KEY, TIERS,
    _internal: { dist, tier, matchPairs, pruneKeep },
  };
})(typeof window !== 'undefined' ? window : globalThis);
