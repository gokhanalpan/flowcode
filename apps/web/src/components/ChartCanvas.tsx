import { edgeHandle, type Insertion, type Layout, type LayoutEdge, type LayoutNode } from '@flowcode/core';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useI18n } from '../i18n';

interface Props {
  layout: Layout;
  /** Block the runner is on, highlighted amber. */
  currentBlockId?: string;
  /** Block a runtime error happened on, highlighted red. */
  errorBlockId?: string;
  breakpoints: ReadonlySet<string>;
  /** Blocks with compile diagnostics. */
  invalidBlockIds: ReadonlySet<string>;
  selectedBlockId?: string;
  /** When this changes, the canvas pans so the block is visible. */
  followBlockId?: string;
  onSelectBlock: (id: string) => void;
  onInsert: (at: Insertion) => void;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

const TAP_SLOP = 6;
const MIN_READABLE = 0.75;

export function ChartCanvas({ layout, currentBlockId, errorBlockId, breakpoints, invalidBlockIds, selectedBlockId, followBlockId, onSelectBlock, onInsert }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; origin: { x: number; y: number }; distance: number; moved: boolean } | null>(null);
  const fitted = useRef(false);
  const [smooth, setSmooth] = useState(false);

  // Fit the chart to the viewport the first time it has a size. Never below MIN_READABLE:
  // small text is worse than scrolling for this audience.
  useEffect(() => {
    const el = host.current;
    if (!el || fitted.current) return;
    const { width, height } = el.getBoundingClientRect();
    if (width === 0) return;
    const scale = Math.max(MIN_READABLE, Math.min(1, (width - 16) / layout.width, (height - 16) / layout.height));
    setView({ x: Math.max(8, (width - layout.width * scale) / 2), y: 8, scale });
    fitted.current = true;
  }, [layout.width, layout.height]);

  // Follow the running block: pan (smoothly) whenever it leaves the middle of the viewport.
  useEffect(() => {
    const el = host.current;
    const node = followBlockId ? layout.nodes.find((n) => n.block?.id === followBlockId) : undefined;
    if (!el || !node) return;
    const { width, height } = el.getBoundingClientRect();
    setView((v) => {
      const cx = v.x + (node.x + node.width / 2) * v.scale;
      const cy = v.y + (node.y + node.height / 2) * v.scale;
      const inside = cx > width * 0.15 && cx < width * 0.85 && cy > height * 0.2 && cy < height * 0.75;
      if (inside) return v;
      setSmooth(true);
      return { ...v, x: width / 2 - (node.x + node.width / 2) * v.scale, y: height * 0.4 - (node.y + node.height / 2) * v.scale };
    });
  }, [followBlockId, layout]);

  const onPointerDown = (e: ReactPointerEvent) => {
    setSmooth(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      start: view,
      origin: pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : { x: e.clientX, y: e.clientY },
      distance: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length >= 2) {
      const distance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const centre = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const factor = g.distance > 0 ? distance / g.distance : 1;
      const scale = clamp(g.start.scale * factor, 0.3, 3);
      const rect = host.current!.getBoundingClientRect();
      const ox = g.origin.x - rect.left;
      const oy = g.origin.y - rect.top;
      setView({
        scale,
        x: ox - (ox - g.start.x) * (scale / g.start.scale) + (centre.x - g.origin.x),
        y: oy - (oy - g.start.y) * (scale / g.start.scale) + (centre.y - g.origin.y),
      });
      g.moved = true;
    } else {
      const dx = e.clientX - g.origin.x;
      const dy = e.clientY - g.origin.y;
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) g.moved = true;
      if (g.moved) setView({ ...g.start, x: g.start.x + dx, y: g.start.y + dy });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      // One finger of a pinch lifted: restart the gesture from where the view is now, anchored
      // on the finger that stayed, so it pans from here instead of jumping to the old centre.
      const [remaining] = [...pointers.current.values()];
      setView((v) => {
        gesture.current = { start: v, origin: { x: remaining.x, y: remaining.y }, distance: 0, moved: true };
        return v;
      });
      return;
    }
    if (pointers.current.size === 0) {
      // Keep `moved` alive briefly so the click that follows a drag is ignored.
      const g = gesture.current;
      setTimeout(() => { if (gesture.current === g) gesture.current = null; }, 0);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = host.current!.getBoundingClientRect();
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const scale = clamp(view.scale * (e.deltaY < 0 ? 1.1 : 0.9), 0.4, 3);
    setView({ scale, x: ox - (ox - view.x) * (scale / view.scale), y: oy - (oy - view.y) * (scale / view.scale) });
  };

  const tapped = (): boolean => !(gesture.current?.moved);
  const zoomBy = (factor: number) => {
    const rect = host.current!.getBoundingClientRect();
    const ox = rect.width / 2;
    const oy = rect.height / 2;
    const scale = clamp(view.scale * factor, 0.3, 3);
    setView({ scale, x: ox - (ox - view.x) * (scale / view.scale), y: oy - (oy - view.y) * (scale / view.scale) });
  };

  return (
    <div
      className="canvas"
      ref={host}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <svg className="chart" width="100%" height="100%">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" className="grid-line" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
          </marker>
        </defs>
        <g style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0', transition: smooth ? 'transform 350ms ease-out' : 'none' }}>
          <rect x={-4000} y={-4000} width={8000 + layout.width} height={8000 + layout.height} fill="url(#grid)" />
          {layout.edges.map((e) => (
            <Edge key={e.id} edge={e} onInsert={(at) => tapped() && onInsert(at)} />
          ))}
          {layout.nodes.map((n) => (
            <Node
              key={n.id}
              node={n}
              label={n.label}
              state={n.block && [
                n.block.id === errorBlockId && 'error',
                n.block.id === currentBlockId && 'current',
                n.block.id === selectedBlockId && 'selected',
                invalidBlockIds.has(n.block.id) && 'invalid',
                breakpoints.has(n.block.id) && 'breakpoint',
              ].filter(Boolean).join(' ')}
              onTap={() => n.block && tapped() && onSelectBlock(n.block.id)}
            />
          ))}
        </g>
      </svg>
      <div className="zoom">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
      </div>
    </div>
  );
}

function Node({ node, label, state, onTap }: { node: LayoutNode; label: string; state: string | undefined | false; onTap: () => void }) {
  const { x, y, width: w, height: h } = node;
  const cls = `node node-${node.shape} ${state || ''}`;
  let shape: JSX.Element;
  switch (node.shape) {
    case 'terminal': shape = <rect x={x} y={y} width={w} height={h} rx={h / 2} />; break;
    case 'decision': shape = <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />; break;
    case 'io': shape = <polygon points={`${x + 12},${y} ${x + w},${y} ${x + w - 12},${y + h} ${x},${y + h}`} />; break;
    case 'loop': shape = <polygon points={`${x + 14},${y} ${x + w - 14},${y} ${x + w},${y + h / 2} ${x + w - 14},${y + h} ${x + 14},${y + h} ${x},${y + h / 2}`} />; break;
    default: shape = <rect x={x} y={y} width={w} height={h} rx={6} />;
  }
  return (
    <g className={cls} onClick={onTap} role={node.block ? 'button' : undefined}>
      {shape}
      <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central">{label}</text>
      {state && state.includes('breakpoint') && <circle className="bp" cx={x + 2} cy={y + 2} r={6} />}
    </g>
  );
}

function Edge({ edge, onInsert }: { edge: LayoutEdge; onInsert: (at: Insertion) => void }) {
  const { t } = useI18n();
  const handle = edge.insertion ? edgeHandle(edge) : null;
  const first = edge.points[0];
  const second = edge.points[1] ?? first;
  const labelX = first.x + (second.x > first.x ? 8 : second.x < first.x ? -8 : 10);
  const labelY = first.y + (second.y !== first.y && second.x === first.x ? 14 : -6);
  return (
    <g className="edge">
      <polyline points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')} markerEnd={edge.arrow ? 'url(#arrow)' : undefined} />
      {edge.label && (
        <text x={labelX} y={labelY} textAnchor={second.x < first.x ? 'end' : 'start'} className="edge-label">{t(edge.label === 'true' ? 'edge.true' : 'edge.false')}</text>
      )}
      {handle && (
        <g className="insert" onClick={() => onInsert(edge.insertion!)} role="button">
          <circle cx={handle.x} cy={handle.y} r={11} />
          <path d={`M ${handle.x - 5} ${handle.y} h 10 M ${handle.x} ${handle.y - 5} v 10`} />
          {/* generous invisible hit area for fingers */}
          <circle cx={handle.x} cy={handle.y} r={20} className="hit" />
        </g>
      )}
    </g>
  );
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
