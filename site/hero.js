// Hero: the 3D mark is a Remotion turntable (studio/src/keeper-turn.tsx, 61 frames from turned-left to
// turned-right). We show the frame that matches the pointer, so it turns like live 3D at render quality.
// Also: pause the background loop when the hero is off screen, and run the sample-answers log.
const TURN_FRAMES = 61; // must match TURN_FRAMES in studio/src/keeper-turn.tsx
const MID = (TURN_FRAMES - 1) / 2;
const $ = (id) => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// data-v is the frames' content hash, written by studio/render-assets.mjs, so new renders are new URLs.
const frameUrl = (i) => `assets/turn/${String(i).padStart(2, "0")}.webp?v=${$("turn")?.dataset.v ?? ""}`;

function turntable() {
  const cv = $("turn"), mark = $("hero-mark"), hero = $("hero");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const imgs = new Array(TURN_FRAMES);
  let shown = -1;

  // Load the middle frame first, then fan outward so the nearest angles arrive first.
  const order = [MID];
  for (let d = 1; d <= MID; d++) order.push(MID - d, MID + d);
  order.forEach((i, n) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => { imgs[i] = img; if (n === 0) draw(MID); };
    img.src = frameUrl(i);
  });

  // Nearest frame that has loaded, so a fast flick never shows a blank canvas.
  function draw(i) {
    const base = Math.min(TURN_FRAMES - 1, Math.max(0, Math.round(i)));
    let k = -1;
    for (let d = 0; d < TURN_FRAMES && k < 0; d++) k = imgs[base + d] ? base + d : imgs[base - d] ? base - d : -1;
    if (k < 0 || k === shown) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(imgs[k], 0, 0, cv.width, cv.height);
    shown = k;
  }

  if (reduce) return;

  let target = MID, cur = MID, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0, lastMove = -1e9, on = true;
  addEventListener("pointermove", (e) => {
    const x = e.clientX / innerWidth, y = e.clientY / innerHeight;
    target = x * (TURN_FRAMES - 1);
    aimX = (y - 0.5) * -10; aimY = (x - 0.5) * 6;
    lastMove = performance.now();
  }, { passive: true });

  new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) requestAnimationFrame(tick); }).observe(hero);

  function tick(now) {
    // After 2.5s without the pointer, sway slowly on its own.
    if (now - lastMove > 2500) { target = MID + Math.sin(now / 2600) * 14; aimX *= 0.98; aimY *= 0.98; }
    cur += (target - cur) * 0.09;
    tiltX += (aimX - tiltX) * 0.06; tiltY += (aimY - tiltY) * 0.06;
    draw(cur);
    mark.style.transform = `perspective(1200px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
    if (on) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function fieldVideo() {
  const v = $("hero-field");
  if (!v) return;
  if (reduce) { v.removeAttribute("autoplay"); v.pause(); return; }
  new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }).observe(v);
}

// The three answers: one word lights up at a time; hovering a word holds it.
function answers() {
  const items = [...document.querySelectorAll("#answers li")];
  if (!items.length) return;
  let i = 0, held = false;
  const light = (k) => items.forEach((li, j) => li.classList.toggle("on", j === k));
  light(0);
  items.forEach((li, k) => {
    li.addEventListener("pointerenter", () => { held = true; light(k); });
    li.addEventListener("pointerleave", () => { held = false; i = k; });
  });
  if (reduce) return;
  setInterval(() => { if (!held) light((i = (i + 1) % items.length)); }, 2400);
}

turntable(); fieldVideo(); answers();
