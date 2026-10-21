/**
 * A crisp, auto-sized 2D canvas. `draw` runs on every render (and every animation frame while
 * `animate` is true) with a context already scaled to CSS pixels. Pointer events report CSS
 * pixel coordinates relative to the canvas.
 */
import { useEffect, useRef } from "preact/hooks";

export interface CanvasProps {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, timeMs: number) => void;
  onClick?: (x: number, y: number, ev: MouseEvent) => void;
  onMove?: (x: number, y: number) => void;
  onLeave?: () => void;
  onWheel?: (deltaY: number, x: number, y: number) => void;
  animate?: boolean;
  class?: string;
}

export function Canvas({ draw, onClick, onMove, onLeave, onWheel, animate = false, class: className }: CanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const paint = (time: number) => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    drawRef.current(ctx, w, h, time);
  };

  useEffect(() => {
    paint(performance.now());
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => paint(performance.now()));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!animate) return;
    let frame = requestAnimationFrame(function loop(t) {
      paint(t);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  const local = (ev: MouseEvent): [number, number] => {
    const rect = (ev.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  };

  return (
    <canvas
      ref={ref}
      class={`map-canvas ${className ?? ""}`}
      onClick={onClick && ((ev) => onClick(...local(ev), ev))}
      onMouseMove={onMove && ((ev) => onMove(...local(ev)))}
      onMouseLeave={onLeave}
      onWheel={
        onWheel &&
        ((ev) => {
          ev.preventDefault();
          onWheel(ev.deltaY, ...local(ev));
        })
      }
    />
  );
}
