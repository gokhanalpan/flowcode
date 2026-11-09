import type { Block } from './ir';

/**
 * Auto-layout for the structured flowchart. The chart has no free arrows, so layout is
 * deterministic: sequences stack on an axis, If branches hang left (true) and right (false)
 * and merge below, loops put the body under the condition with the back edge on the left
 * and the exit on the right.
 *
 * Every edge that corresponds to a position in a block list carries an `insertion` — the
 * editor shows a "+" there and inserts a new block at exactly that position.
 */

export type Slot = 'main' | 'then' | 'else' | 'body';

export interface Insertion {
  /** Block id of the compound block owning the slot; null for the function body itself. */
  parentId: string | null;
  slot: Slot;
  index: number;
}

export type NodeShape = 'terminal' | 'process' | 'io' | 'decision' | 'loop' | 'comment' | 'jump';

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  shape: NodeShape;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Possibly truncated to fit; the full text lives on the block. */
  label: string;
  block?: Block;
}

export interface LayoutEdge {
  id: string;
  points: Point[];
  /** Branch label key; the UI translates it. */
  label?: 'true' | 'false';
  arrow: boolean;
  insertion?: Insertion;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Localized one-line summary of a block, used for node text and width. */
  labelOf: (block: Block) => string;
  startLabel?: string;
  endLabel?: string;
  charWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  nodeHeight?: number;
  /** Vertical space between nodes; the "+" button lives here. */
  gap?: number;
  /** Horizontal space between If branches. */
  branchGap?: number;
  /** Extra room on the sides of a loop for the back and exit edges. */
  loopMargin?: number;
  padding?: number;
}

interface Extent {
  left: number;
  right: number;
  height: number;
}

/** Length of the short vertical stub at the start of a loop's back edge; also the "+" button's minimum room. */
const LOOP_STUB = 28;
/** How far above (while/for) or below (do-while) the node the back edge joins the incoming line. */
const JOIN_OFFSET = 8;

const SHAPES: Record<Block['kind'], NodeShape> = {
  declare: 'process', assign: 'process', call: 'process',
  input: 'io', output: 'io',
  if: 'decision', while: 'decision', doWhile: 'decision',
  for: 'loop',
  comment: 'comment',
  break: 'jump', return: 'jump',
};

export function layoutBlocks(blocks: Block[], options: LayoutOptions): Layout {
  return new Layouter(options).run(blocks);
}

class Layouter {
  private readonly nodes: LayoutNode[] = [];
  private readonly edges: LayoutEdge[] = [];
  private readonly cw: number;
  private readonly minW: number;
  private readonly maxW: number;
  private readonly h: number;
  private readonly gap: number;
  private readonly branchGap: number;
  private readonly margin: number;
  private readonly padding: number;
  private readonly extents = new Map<Block, Extent>();
  private edgeCount = 0;

  constructor(private readonly o: LayoutOptions) {
    this.cw = o.charWidth ?? 7.8;
    this.minW = o.minWidth ?? 120;
    this.maxW = o.maxWidth ?? 280;
    this.h = o.nodeHeight ?? 44;
    this.gap = o.gap ?? 48;
    this.branchGap = o.branchGap ?? 36;
    this.margin = o.loopMargin ?? 32;
    this.padding = o.padding ?? 24;
  }

  run(blocks: Block[]): Layout {
    const seq = this.measureSeq(blocks);
    const terminalW = 110;
    const left = Math.max(seq.left, terminalW / 2) + this.padding;
    const axis = left;
    const top = this.padding;

    const start = this.node('start', 'terminal', axis, top, terminalW, this.h, this.o.startLabel ?? 'start');
    const bodyTop = start.y + start.height + this.gap;
    const placed = this.placeSeq(blocks, axis, bodyTop, null, 'main');

    const endTop = (placed.empty ? bodyTop : placed.bottom + this.gap);
    const end = this.node('end', 'terminal', axis, endTop, terminalW, this.h, this.o.endLabel ?? 'end');

    if (placed.empty) {
      this.edge([{ x: axis, y: start.y + start.height }, { x: axis, y: end.y }], true, { parentId: null, slot: 'main', index: 0 });
    } else {
      this.edge([{ x: axis, y: start.y + start.height }, { x: axis, y: placed.firstTop }], true, { parentId: null, slot: 'main', index: 0 });
      this.edge([{ x: axis, y: placed.bottom }, { x: axis, y: end.y }], true, { parentId: null, slot: 'main', index: blocks.length });
    }

    const width = axis + Math.max(seq.right, terminalW / 2) + this.padding;
    const height = end.y + end.height + this.padding;
    return { nodes: this.nodes, edges: this.edges, width, height };
  }

  // ---------------------------------------------------------------------------
  // Measuring (bottom-up)

  /** Slanted shapes lose width at the corners, so they get extra padding. */
  private padFor(shape: NodeShape): number {
    return shape === 'io' ? 52 : shape === 'loop' ? 56 : 28;
  }

  private labelWidth(label: string, shape: NodeShape = 'process'): number {
    return Math.min(this.maxW, Math.max(this.minW, label.length * this.cw + this.padFor(shape)));
  }

  private fitLabel(label: string, width: number, shape: NodeShape = 'process'): string {
    const usable = shape === 'decision' ? width * 0.62 : width - this.padFor(shape);
    const maxChars = Math.floor(usable / this.cw + 1e-6);
    return label.length > maxChars ? label.slice(0, Math.max(1, maxChars - 1)) + '…' : label;
  }

  /** Text has to fit the middle of a diamond, so it is about 1.6× as wide as its label. */
  private decisionSize(label: string): { w: number; h: number } {
    return { w: Math.min(this.maxW * 1.6, Math.max(170, label.length * this.cw / 0.62 + 24)), h: this.h + 20 };
  }

  private measureSeq(blocks: Block[]): Extent {
    let left = 0;
    let right = 0;
    let height = 0;
    blocks.forEach((b, i) => {
      const e = this.measure(b);
      left = Math.max(left, e.left);
      right = Math.max(right, e.right);
      height += e.height + (i > 0 ? this.gap : 0);
    });
    return { left, right, height };
  }

  private measure(b: Block): Extent {
    const cached = this.extents.get(b);
    if (cached) return cached;
    const label = this.o.labelOf(b);
    let e: Extent;

    switch (b.kind) {
      case 'if': {
        const g = this.ifGeometry(b, label);
        e = {
          left: g.leftOffset + Math.max(g.t.left, 20),
          right: g.rightOffset + Math.max(g.f.right, 20),
          height: g.d.h + this.gap + Math.max(g.t.height, g.f.height) + this.gap,
        };
        break;
      }
      case 'while':
      case 'for': {
        const d = b.kind === 'for' ? { w: this.labelWidth(label, 'loop'), h: this.h } : this.decisionSize(label);
        const body = this.measureSeq(b.body);
        e = {
          left: Math.max(d.w / 2, body.left) + this.margin,
          right: Math.max(d.w / 2, body.right) + this.margin,
          height: d.h + this.gap + body.height + this.gap,
        };
        break;
      }
      case 'doWhile': {
        const d = this.decisionSize(label);
        const body = this.measureSeq(b.body);
        e = {
          left: Math.max(d.w / 2, body.left) + this.margin,
          right: Math.max(d.w / 2, body.right),
          height: this.gap + body.height + this.gap + d.h,
        };
        break;
      }
      default: {
        const w = this.labelWidth(label, SHAPES[b.kind]);
        e = { left: w / 2, right: w / 2, height: this.h };
      }
    }
    this.extents.set(b, e);
    return e;
  }

  /**
   * Where an If's branch axes sit relative to the main axis: far enough that the columns don't
   * touch, and never inside the diamond, so branch edges always leave the vertices outward.
   */
  private ifGeometry(b: Block & { kind: 'if' }, label: string) {
    const d = this.decisionSize(label);
    const t = this.measureSeq(b.then);
    const f = this.measureSeq(b.else);
    const leftCol = Math.max(t.left + t.right, 40);
    const rightCol = Math.max(f.left + f.right, 40);
    return {
      d, t, f,
      leftOffset: Math.max(this.branchGap / 2 + leftCol / 2, d.w / 2 + 16),
      rightOffset: Math.max(this.branchGap / 2 + rightCol / 2, d.w / 2 + 16),
    };
  }

  // ---------------------------------------------------------------------------
  // Placing (top-down)

  /** Places a sequence on `axis` starting at `top`. Returns where its outgoing edge begins. */
  private placeSeq(blocks: Block[], axis: number, top: number, parentId: string | null, slot: Slot): { bottom: number; firstTop: number; empty: boolean } {
    if (blocks.length === 0) return { bottom: top, firstTop: top, empty: true };
    let y = top;
    let previousBottom = 0;
    blocks.forEach((b, i) => {
      if (i > 0) {
        this.edge([{ x: axis, y: previousBottom }, { x: axis, y }], true, { parentId, slot, index: i });
      }
      previousBottom = this.place(b, axis, y);
      y = previousBottom + this.gap;
    });
    return { bottom: previousBottom, firstTop: top, empty: false };
  }

  /** Places one block with its top at `y`; returns the y where its outgoing edge starts. */
  private place(b: Block, axis: number, y: number): number {
    const label = this.o.labelOf(b);
    const ext = this.measure(b);

    switch (b.kind) {
      case 'if': {
        const { d, leftOffset, rightOffset } = this.ifGeometry(b, label);
        const node = this.node(b.id, 'decision', axis, y, d.w, d.h, this.fitLabel(label, d.w, 'decision'), b);
        const cy = y + d.h / 2;
        const leftAxis = axis - leftOffset;
        const rightAxis = axis + rightOffset;
        const branchTop = y + d.h + this.gap;
        const mergeY = y + ext.height;

        const tp = this.placeSeq(b.then, leftAxis, branchTop, b.id, 'then');
        const fp = this.placeSeq(b.else, rightAxis, branchTop, b.id, 'else');

        this.edge([{ x: node.x, y: cy }, { x: leftAxis, y: cy }, { x: leftAxis, y: tp.empty ? mergeY : tp.firstTop }, ...(tp.empty ? [{ x: axis, y: mergeY }] : [])],
          !tp.empty, { parentId: b.id, slot: 'then', index: 0 }, 'true');
        this.edge([{ x: node.x + node.width, y: cy }, { x: rightAxis, y: cy }, { x: rightAxis, y: fp.empty ? mergeY : fp.firstTop }, ...(fp.empty ? [{ x: axis, y: mergeY }] : [])],
          !fp.empty, { parentId: b.id, slot: 'else', index: 0 }, 'false');
        if (!tp.empty) this.edge([{ x: leftAxis, y: tp.bottom }, { x: leftAxis, y: mergeY }, { x: axis, y: mergeY }], false, { parentId: b.id, slot: 'then', index: b.then.length });
        if (!fp.empty) this.edge([{ x: rightAxis, y: fp.bottom }, { x: rightAxis, y: mergeY }, { x: axis, y: mergeY }], false, { parentId: b.id, slot: 'else', index: b.else.length });
        return mergeY;
      }

      case 'while':
      case 'for': {
        const isFor = b.kind === 'for';
        const d = isFor ? { w: this.labelWidth(label, 'loop'), h: this.h } : this.decisionSize(label);
        const node = this.node(b.id, isFor ? 'loop' : 'decision', axis, y, d.w, d.h, this.fitLabel(label, d.w, isFor ? 'loop' : 'decision'), b);
        const cy = y + d.h / 2;
        const body = this.measureSeq(b.body);
        const bodyTop = y + d.h + this.gap;
        const leftX = axis - Math.max(d.w / 2, body.left) - this.margin;
        const rightX = axis + Math.max(d.w / 2, body.right) + this.margin;
        const exitY = y + ext.height;

        const bp = this.placeSeq(b.body, axis, bodyTop, b.id, 'body');
        this.edge([{ x: axis, y: y + d.h }, { x: axis, y: bodyTop }], !bp.empty, { parentId: b.id, slot: 'body', index: 0 }, 'true');
        const loopFrom = bp.empty ? bodyTop : bp.bottom;
        // The back edge joins the incoming line just above the node, clear of that edge's "+" button.
        this.edge(
          [{ x: axis, y: loopFrom }, { x: axis, y: loopFrom + LOOP_STUB }, { x: leftX, y: loopFrom + LOOP_STUB }, { x: leftX, y: y - JOIN_OFFSET }, { x: axis, y: y - JOIN_OFFSET }],
          false,
          bp.empty ? undefined : { parentId: b.id, slot: 'body', index: b.body.length },
        );
        this.edge([{ x: node.x + node.width, y: cy }, { x: rightX, y: cy }, { x: rightX, y: exitY }, { x: axis, y: exitY }], false, undefined, 'false');
        return exitY;
      }

      case 'doWhile': {
        const d = this.decisionSize(label);
        const body = this.measureSeq(b.body);
        const bodyTop = y + this.gap;
        const bp = this.placeSeq(b.body, axis, bodyTop, b.id, 'body');
        const diamondTop = bp.empty ? bodyTop : bp.bottom + this.gap;
        const node = this.node(b.id, 'decision', axis, diamondTop, d.w, d.h, this.fitLabel(label, d.w, 'decision'), b);
        const cy = diamondTop + d.h / 2;
        const leftX = axis - Math.max(d.w / 2, body.left) - this.margin;

        this.edge([{ x: axis, y }, { x: axis, y: bodyTop }], !bp.empty, { parentId: b.id, slot: 'body', index: 0 });
        if (!bp.empty) this.edge([{ x: axis, y: bp.bottom }, { x: axis, y: diamondTop }], true, { parentId: b.id, slot: 'body', index: b.body.length });
        this.edge([{ x: node.x, y: cy }, { x: leftX, y: cy }, { x: leftX, y: y + JOIN_OFFSET }, { x: axis, y: y + JOIN_OFFSET }], false, undefined, 'true');
        return diamondTop + d.h;
      }

      default: {
        const shape = SHAPES[b.kind];
        const w = this.labelWidth(label, shape);
        const node = this.node(b.id, shape, axis, y, w, this.h, this.fitLabel(label, w, shape), b);
        return node.y + node.height;
      }
    }
  }

  // ---------------------------------------------------------------------------

  private node(id: string, shape: NodeShape, axis: number, y: number, width: number, height: number, label: string, block?: Block): LayoutNode {
    const n: LayoutNode = { id, shape, x: axis - width / 2, y, width, height, label, block };
    this.nodes.push(n);
    return n;
  }

  private edge(points: Point[], arrow: boolean, insertion?: Insertion, label?: 'true' | 'false'): void {
    this.edges.push({ id: `e${this.edgeCount++}`, points, arrow, insertion, label });
  }
}

/**
 * Where the "+" button goes: the first vertical segment long enough to hold it, so the button
 * sits directly under the block it inserts after; failing that, the longest segment.
 */
export function edgeHandle(edge: LayoutEdge): Point {
  const segments = edge.points.slice(1).map((b, i) => {
    const a = edge.points[i];
    return { a, b, vertical: a.x === b.x, len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) };
  });
  const pick = segments.find((s) => s.vertical && s.len >= LOOP_STUB)
    ?? segments.find((s) => s.len >= LOOP_STUB)
    ?? segments.reduce((best, s) => (s.len > best.len ? s : best), segments[0]);
  return { x: (pick.a.x + pick.b.x) / 2, y: (pick.a.y + pick.b.y) / 2 };
}
