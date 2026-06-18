const canvas = document.querySelector("#signal-canvas");
const context = canvas?.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let width = 0;
let height = 0;
let nodes = [];
let animationFrame = 0;

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resizeCanvas() {
  if (!canvas || !context) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const count = Math.max(30, Math.min(72, Math.floor((width * height) / 18000)));
  nodes = Array.from({ length: count }, (_, index) => {
    const band = index % 4;
    return {
      x: (index * 149) % Math.max(width, 1),
      y: ((index * 97) % Math.max(height, 1)) + band * 12,
      size: 1 + (index % 3) * 0.45,
      drift: 0.12 + (index % 5) * 0.025,
      phase: index * 0.72,
    };
  });
}

function draw(timestamp = 0) {
  if (!canvas || !context) return;

  const accent = cssColor("--accent", "oklch(0.78 0.14 205)");
  const accentDim = cssColor("--accent-dim", "oklch(0.54 0.09 205)");
  const primary = cssColor("--primary-strong", "oklch(0.57 0.17 5)");

  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const movement = reducedMotion.matches ? 0 : timestamp * 0.00008 * node.drift;
    const x = (node.x + movement * width + Math.sin(timestamp * 0.0004 + node.phase) * 8) % width;
    const y = (node.y + Math.cos(timestamp * 0.00032 + node.phase) * 10 + height) % height;

    context.fillStyle = index % 5 === 0 ? primary : accent;
    context.globalAlpha = index % 5 === 0 ? 0.38 : 0.26;
    context.beginPath();
    context.arc(x, y, node.size, 0, Math.PI * 2);
    context.fill();

    for (let next = index + 1; next < nodes.length; next += 1) {
      const other = nodes[next];
      const otherX = (other.x + movement * width * 0.78) % width;
      const otherY = (other.y + height) % height;
      const distance = Math.hypot(x - otherX, y - otherY);

      if (distance < 150) {
        context.strokeStyle = index % 4 === 0 ? primary : accentDim;
        context.globalAlpha = Math.max(0, (150 - distance) / 150) * 0.12;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(otherX, otherY);
        context.stroke();
      }
    }
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;

  if (!reducedMotion.matches) {
    animationFrame = window.requestAnimationFrame(draw);
  }
}

function restart() {
  window.cancelAnimationFrame(animationFrame);
  resizeCanvas();
  draw();
  if (!reducedMotion.matches) {
    animationFrame = window.requestAnimationFrame(draw);
  }
}

window.addEventListener("resize", restart, { passive: true });
if (typeof reducedMotion.addEventListener === "function") {
  reducedMotion.addEventListener("change", restart);
} else if (typeof reducedMotion.addListener === "function") {
  reducedMotion.addListener(restart);
}
restart();
