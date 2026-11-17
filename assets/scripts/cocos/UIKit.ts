import {
  Color,
  Graphics,
  Label,
  Layers,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
  Vec3,
  tween,
  UIOpacity,
} from 'cc';
import { Assets } from './Assets';
import { FONT } from './Theme';

export function newNode(name: string, parent: Node | null = null): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  if (parent) parent.addChild(n);
  return n;
}

export function setSize(node: Node, w: number, h: number): UITransform {
  const t = node.getComponent(UITransform) || node.addComponent(UITransform);
  t.setContentSize(w, h);
  return t;
}

export function setOpacity(node: Node, value: number): void {
  const o = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
  o.opacity = value;
}

export interface LabelOptions {
  width?: number;
  height?: number;
  align?: number;
  wrap?: boolean;
  display?: boolean;
  bold?: boolean;
  lineHeight?: number;
  name?: string;
}

export function makeLabel(
  parent: Node,
  text: string,
  size: number,
  color: Color,
  opts: LabelOptions = {},
): Label {
  const n = newNode(opts.name ?? 'label', parent);
  const label = n.addComponent(Label);
  label.string = text;
  label.fontSize = size;
  label.lineHeight = opts.lineHeight ?? Math.round(size * 1.2);
  label.color = color;
  label.overflow = opts.wrap ? Label.Overflow.RESIZE_HEIGHT : Label.Overflow.NONE;
  label.enableWrapText = !!opts.wrap;
  label.horizontalAlign =
    opts.align === 0
      ? Label.HorizontalAlign.LEFT
      : opts.align === 2
        ? Label.HorizontalAlign.RIGHT
        : Label.HorizontalAlign.CENTER;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  if (opts.bold) label.isBold = true;
  if (opts.display !== false && Assets.font) {
    label.font = Assets.font;
    label.useSystemFont = false;
  }
  const w = opts.width ?? size * Math.max(1, text.length) + 8;
  const h = opts.height ?? Math.round(label.lineHeight * (opts.wrap ? 3 : 1) + 4);
  setSize(n, w, h);
  return label;
}

export function makeSprite(
  parent: Node,
  frame: SpriteFrame | null,
  w: number,
  h: number,
  name = 'sprite',
): Sprite {
  const n = newNode(name, parent);
  const sp = n.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.trim = false;
  if (frame) sp.spriteFrame = frame;
  setSize(n, w, h);
  return sp;
}

export function makeIcon(parent: Node, name: string, size: number, tint?: Color): Node {
  const frame = Assets.frame(name);
  const n = newNode(`icon-${name}`, parent);
  setSize(n, size, size);
  if (frame) {
    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = frame;
    if (tint) sp.color = tint;
  }
  return n;
}

export function drawRoundRect(g: Graphics, w: number, h: number, r: number): void {
  g.roundRect(-w / 2, -h / 2, w, h, r);
}

export interface PanelOptions {
  radius?: number;
  fill?: Color;
  shadow?: Color;
  shadowOffset?: number;
  border?: Color;
  borderWidth?: number;
  highlight?: boolean;
}

/** Rounded card with a fake drop shadow and optional top highlight. */
export function makePanel(parent: Node, w: number, h: number, opts: PanelOptions = {}): Node {
  const n = newNode('panel', parent);
  setSize(n, w, h);
  const g = n.addComponent(Graphics);
  const radius = opts.radius ?? 24;

  if (opts.shadow) {
    g.fillColor = opts.shadow;
    g.roundRect(-w / 2, -h / 2 - (opts.shadowOffset ?? 6), w, h, radius);
    g.fill();
  }
  g.fillColor = opts.fill ?? Color.WHITE;
  drawRoundRect(g, w, h, radius);
  g.fill();

  if (opts.highlight) {
    g.fillColor = new Color(255, 255, 255, 46);
    g.roundRect(-w / 2 + 4, h / 2 - h * 0.44, w - 8, h * 0.4, radius * 0.8);
    g.fill();
  }
  if (opts.border) {
    g.lineWidth = opts.borderWidth ?? 3;
    g.strokeColor = opts.border;
    drawRoundRect(g, w, h, radius);
    g.stroke();
  }
  return n;
}

export interface ButtonOptions {
  w: number;
  h: number;
  radius?: number;
  fill?: Color;
  fillTop?: Color;
  shadow?: Color;
  shadowOffset?: number;
  text?: string;
  textSize?: number;
  textColor?: Color;
  icon?: string;
  iconSize?: number;
  onClick?: () => void;
  display?: boolean;
  systemFont?: boolean;
}

export interface ButtonHandle {
  node: Node;
  label: Label | null;
  icon: Node | null;
  setText(text: string): void;
  setEnabled(enabled: boolean): void;
  setVisible(v: boolean): void;
}

/** Chunky 3D button with press feedback. */
export function makeButton(parent: Node, opts: ButtonOptions): ButtonHandle {
  const w = opts.w;
  const h = opts.h;
  const radius = opts.radius ?? Math.min(28, h / 2);
  const n = newNode('button', parent);
  setSize(n, w, h);

  const g = n.addComponent(Graphics);
  const shadowOffset = opts.shadowOffset ?? 8;
  if (opts.shadow) {
    g.fillColor = opts.shadow;
    g.roundRect(-w / 2, -h / 2 - shadowOffset, w, h, radius);
    g.fill();
  }
  g.fillColor = opts.fill ?? new Color(52, 152, 239, 255);
  drawRoundRect(g, w, h, radius);
  g.fill();

  if (opts.fillTop) {
    g.fillColor = opts.fillTop;
    g.roundRect(-w / 2 + 3, -h / 2 + h * 0.5, w - 6, h * 0.44, radius * 0.75);
    g.fill();
  }

  let label: Label | null = null;
  let iconNode: Node | null = null;
  if (opts.icon) {
    const iconSize = opts.iconSize ?? h * 0.52;
    iconNode = makeIcon(n, opts.icon, iconSize);
    if (iconNode) iconNode.setPosition(opts.text ? -w * 0.22 : 0, 0, 0);
  }
  if (opts.text) {
    label = makeLabel(n, opts.text, opts.textSize ?? FONT.button, opts.textColor ?? Color.WHITE, {
      width: w,
      height: h,
      name: 'btn-label',
      display: opts.systemFont ? false : undefined,
    });
    if (iconNode) label.node.setPosition(w * 0.08, 0, 0);
  }

  let enabled = true;
  n.on(
    Node.EventType.TOUCH_START,
    () => {
      if (!enabled) return;
      n.setScale(0.97, 0.97, 1);
    },
    n,
  );
  n.on(
    Node.EventType.TOUCH_END,
    () => {
      if (!enabled) return;
      n.setScale(1, 1, 1);
      opts.onClick?.();
    },
    n,
  );
  n.on(
    Node.EventType.TOUCH_CANCEL,
    () => {
      n.setScale(1, 1, 1);
    },
    n,
  );

  return {
    node: n,
    label,
    icon: iconNode,
    setText(text: string) {
      if (label) label.string = text;
    },
    setEnabled(v: boolean) {
      enabled = v;
      setOpacity(n, v ? 255 : 130);
    },
    setVisible(v: boolean) {
      n.active = v;
    },
  };
}

export function popIn(node: Node, delay = 0): void {
  node.setScale(0.7, 0.7, 1);
  const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
  op.opacity = 0;
  tween(node)
    .delay(delay)
    .parallel(
      tween(node).to(0.24, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }),
      tween(op).to(0.18, { opacity: 255 }),
    )
    .start();
}

export function fadeIn(node: Node, duration = 0.18): void {
  const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
  op.opacity = 0;
  tween(op).to(duration, { opacity: 255 }).start();
}

export function bump(node: Node, scale = 1.12, duration = 0.12): void {
  tween(node)
    .to(duration / 2, { scale: new Vec3(scale, scale, 1) })
    .to(duration / 2, { scale: new Vec3(1, 1, 1) })
    .start();
}