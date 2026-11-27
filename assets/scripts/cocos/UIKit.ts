import {
  Color,
  Graphics,
  Label,
  Layers,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
  Vec2,
  Vec3,
  tween,
  UIOpacity,
} from 'cc';
import { Assets } from './Assets';
import { I18n } from './I18n';
import { BTN_STYLES, ButtonStyleName, C, FONT } from './Theme';

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
  outlineColor?: Color;
  outlineWidth?: number;
  shadowColor?: Color;
  shadowOffset?: Vec2;
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
  label.lineHeight = opts.lineHeight ?? Math.round(size * 1.24);
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
  const useZhFont = I18n.lang === 'zh' && opts.display !== false && !!Assets.font;
  if (useZhFont && Assets.font) {
    label.font = Assets.font;
    label.useSystemFont = false;
    if (opts.bold) label.isBold = true;
  } else {
    label.useSystemFont = true;
    label.fontFamily = 'Arial Rounded MT Bold, Helvetica Neue, Arial, sans-serif';
    label.isBold = opts.bold !== false;
  }
  if (opts.outlineColor) {
    label.enableOutline = true;
    label.outlineColor = opts.outlineColor;
    label.outlineWidth = opts.outlineWidth ?? Math.max(2, Math.round(size * 0.09));
  }
  if (opts.shadowColor) {
    label.enableShadow = true;
    label.shadowColor = opts.shadowColor;
    label.shadowOffset = opts.shadowOffset ?? new Vec2(0, -3);
    label.shadowBlur = 1;
  }
  const w = opts.width ?? size * Math.max(1, text.length) * (useZhFont ? 1 : 0.72) + 16;
  const h = opts.height ?? Math.round(label.lineHeight * (opts.wrap ? 3 : 1) + 8);
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
  const safeR = Math.max(0, Math.min(r, w / 2 - 1, h / 2 - 1));
  g.roundRect(-w / 2, -h / 2, w, h, safeR);
}

export interface PanelOptions {
  radius?: number;
  fill?: Color;
  shadow?: Color;
  shadowOffset?: number;
  border?: Color;
  borderWidth?: number;
  highlight?: boolean;
  bevel?: Color;
  bevelHeight?: number;
}

/** Tactile Western-casual rounded card with soft drop shadow, bevel & rim border. */
export function makePanel(parent: Node, w: number, h: number, opts: PanelOptions = {}): Node {
  const n = newNode('panel', parent);
  setSize(n, w, h);
  const g = n.addComponent(Graphics);
  const radius = Math.max(0, Math.min(opts.radius ?? 28, w / 2 - 1, h / 2 - 1));

  if (opts.shadow) {
    g.fillColor = opts.shadow;
    g.roundRect(-w / 2, -h / 2 - (opts.shadowOffset ?? 10), w, h, radius);
    g.fill();
  }
  if (opts.bevel) {
    const bh = opts.bevelHeight ?? 7;
    g.fillColor = opts.bevel;
    g.roundRect(-w / 2, -h / 2 - bh, w, h, radius);
    g.fill();
  }

  g.fillColor = opts.fill ?? C.cream;
  drawRoundRect(g, w, h, radius);
  g.fill();

  if (opts.highlight) {
    g.fillColor = new Color(255, 255, 255, 52);
    g.roundRect(-w / 2 + 6, h / 2 - h * 0.42, w - 12, h * 0.36, Math.max(4, radius * 0.72));
    g.fill();
  }
  if (opts.border) {
    g.lineWidth = opts.borderWidth ?? 4;
    g.strokeColor = opts.border;
    drawRoundRect(g, w, h, radius);
    g.stroke();
  }
  return n;
}

/** Folded Western-casual header ribbon banner sitting across the top of cards & modals. */
export function makeRibbon(
  parent: Node,
  text: string,
  w: number,
  h: number,
  fill: Color,
  dark: Color,
  rim: Color,
  fontSize = 36,
): Node {
  const n = newNode('ribbon', parent);
  setSize(n, w + 52, h + 16);
  const g = n.addComponent(Graphics);

  const hw = w / 2;
  const hh = h / 2;
  const tailW = 36;
  const tailDrop = 10;

  // Left & right folded ribbon tails behind main banner
  g.fillColor = dark;
  // Left tail
  g.moveTo(-hw + 12, hh - tailDrop);
  g.lineTo(-hw - tailW, hh - tailDrop);
  g.lineTo(-hw - tailW + 14, -tailDrop);
  g.lineTo(-hw - tailW, -hh - tailDrop);
  g.lineTo(-hw + 12, -hh - tailDrop);
  g.close();
  g.fill();

  // Right tail
  g.moveTo(hw - 12, hh - tailDrop);
  g.lineTo(hw + tailW, hh - tailDrop);
  g.lineTo(hw + tailW - 14, -tailDrop);
  g.lineTo(hw + tailW, -hh - tailDrop);
  g.lineTo(hw - 12, -hh - tailDrop);
  g.close();
  g.fill();

  // Drop shadow under main center ribbon
  g.fillColor = new Color(10, 30, 60, 75);
  g.roundRect(-hw, -hh - 6, w, h, 18);
  g.fill();

  // Bottom 3D bevel of center banner
  g.fillColor = dark;
  g.roundRect(-hw, -hh - 4, w, h, 18);
  g.fill();

  // Main banner body
  g.fillColor = fill;
  g.roundRect(-hw, -hh, w, h, 18);
  g.fill();

  // Upper glossy shine band
  g.fillColor = new Color(255, 255, 255, 58);
  g.roundRect(-hw + 8, 2, w - 16, hh - 6, 12);
  g.fill();

  // Rim border
  g.lineWidth = 3.5;
  g.strokeColor = rim;
  g.roundRect(-hw, -hh, w, h, 18);
  g.stroke();

  makeLabel(n, text, fontSize, C.white, {
    width: w - 24,
    height: h,
    outlineColor: dark,
    outlineWidth: 4,
    shadowColor: new Color(0, 0, 0, 70),
    shadowOffset: new Vec2(0, -2),
  }).node.setPosition(0, 2, 0);

  return n;
}

/** Compact pill badge (mode tags, world tags, counters). */
export function makeBadge(
  parent: Node,
  text: string,
  fill: Color,
  textColor: Color = C.white,
  w = 136,
  h = 38,
  fontSize = 20,
  outlineColor?: Color,
): { node: Node; label: Label } {
  const n = newNode('badge', parent);
  setSize(n, w, h);
  const g = n.addComponent(Graphics);
  const r = Math.max(0, h / 2 - 1);

  g.fillColor = new Color(10, 32, 62, 55);
  g.roundRect(-w / 2, -h / 2 - 3, w, h, r);
  g.fill();

  g.fillColor = fill;
  drawRoundRect(g, w, h, r);
  g.fill();

  g.fillColor = new Color(255, 255, 255, 55);
  g.roundRect(-w / 2 + 5, 1, w - 10, h * 0.4, r * 0.7);
  g.fill();

  if (outlineColor) {
    g.lineWidth = 2.5;
    g.strokeColor = outlineColor;
    drawRoundRect(g, w, h, r);
    g.stroke();
  }

  const label = makeLabel(n, text, fontSize, textColor, {
    width: w - 10,
    height: h,
    outlineColor: outlineColor && textColor.equals(C.white) ? outlineColor : undefined,
    outlineWidth: 2,
  });
  label.node.setPosition(0, 1, 0);
  return { node: n, label };
}

export interface ButtonOptions {
  w: number;
  h: number;
  radius?: number;
  style?: ButtonStyleName;
  fill?: Color;
  fillTop?: Color;
  shadow?: Color;
  outline?: Color;
  shadowOffset?: number;
  text?: string;
  textSize?: number;
  textColor?: Color;
  icon?: string;
  iconSize?: number;
  onClick?: () => void;
  display?: boolean;
  systemFont?: boolean;
  gloss?: boolean;
}

export interface ButtonHandle {
  node: Node;
  label: Label | null;
  icon: Node | null;
  setText(text: string): void;
  setEnabled(enabled: boolean): void;
  setVisible(v: boolean): void;
  repaintStyle(style: ButtonStyleName): void;
}

function drawButtonGfx(
  g: Graphics,
  w: number,
  h: number,
  radius: number,
  fill: Color,
  top: Color,
  bevel: Color,
  outline: Color | null,
  bevelH: number,
  gloss: boolean,
): void {
  g.clear();
  const r = Math.max(0, Math.min(radius, w / 2 - 1, h / 2 - 1));

  // Soft cast drop shadow beneath the 3D bevel
  g.fillColor = new Color(9, 28, 56, 72);
  g.roundRect(-w / 2 + 1, -h / 2 - bevelH - 5, w - 2, h, r);
  g.fill();

  // Outer dark contour framing the whole 3D button
  if (outline) {
    const pad = 3.5;
    g.fillColor = outline;
    g.roundRect(-w / 2 - pad, -h / 2 - bevelH - pad, w + pad * 2, h + bevelH + pad * 2, r + pad * 0.7);
    g.fill();
  }

  // 3D bottom extrusion bevel
  g.fillColor = bevel;
  g.roundRect(-w / 2, -h / 2 - bevelH, w, h, r);
  g.fill();

  // Main button body
  g.fillColor = fill;
  drawRoundRect(g, w, h, r);
  g.fill();

  // Upper bright gradient band (candy toy curvature)
  if (gloss) {
    g.fillColor = top;
    g.roundRect(-w / 2 + 4, 2, w - 8, h * 0.46 - 4, Math.max(4, r * 0.76));
    g.fill();

    // Specular pill shine on top-left
    const shineW = Math.min(w * 0.36, 68);
    const shineH = Math.max(6, Math.min(12, h * 0.13));
    if (w >= 64) {
      g.fillColor = new Color(255, 255, 255, 145);
      g.roundRect(-w / 2 + Math.max(12, r * 0.55), h / 2 - shineH - 7, shineW, shineH, shineH / 2);
      g.fill();
    }
  }
}

/** Juicy Western-casual 3D glossy button with tactile squish feedback. */
export function makeButton(parent: Node, opts: ButtonOptions): ButtonHandle {
  const w = opts.w;
  const h = opts.h;
  const radius = opts.radius ?? Math.min(30, h / 2);
  const tokens = opts.style ? BTN_STYLES[opts.style] : null;
  const fill = opts.fill ?? tokens?.fill ?? BTN_STYLES.blue.fill;
  const top = opts.fillTop ?? tokens?.top ?? new Color(255, 255, 255, 58);
  const bevel = opts.shadow ?? tokens?.bevel ?? BTN_STYLES.blue.bevel;
  const outline = opts.outline ?? tokens?.outline ?? null;
  const bevelH = opts.shadowOffset ?? 8;
  const gloss = opts.gloss !== false;

  const n = newNode('button', parent);
  setSize(n, w, h);

  const g = n.addComponent(Graphics);
  drawButtonGfx(g, w, h, radius, fill, top, bevel, outline, bevelH, gloss);

  let label: Label | null = null;
  let iconNode: Node | null = null;

  const textSize = opts.textSize ?? FONT.button;
  const textColor = opts.textColor ?? tokens?.text ?? Color.WHITE;
  const textOutline = tokens?.textOutline ?? (textColor.equals(Color.WHITE) ? bevel : undefined);

  if (opts.icon && opts.text) {
    const iconSize = opts.iconSize ?? Math.round(h * 0.48);
    const hasCjk = /[\u2E80-\u9FFF]/.test(opts.text);
    const charW = hasCjk ? textSize * 0.96 : textSize * 0.62;
    const estTextW = Math.min(w - iconSize - 34, opts.text.length * charW);
    const gap = 12;
    const totalW = iconSize + gap + estTextW;
    iconNode = makeIcon(n, opts.icon, iconSize);
    iconNode.setPosition(-totalW / 2 + iconSize / 2, 2, 0);

    label = makeLabel(n, opts.text, textSize, textColor, {
      width: Math.max(estTextW + 20, w - iconSize - 36),
      height: h,
      name: 'btn-label',
      display: opts.systemFont ? false : undefined,
      outlineColor: textOutline ?? undefined,
      outlineWidth: textOutline ? Math.max(2, Math.round(textSize * 0.09)) : undefined,
      shadowColor: textOutline ? new Color(0, 0, 0, 75) : undefined,
      shadowOffset: new Vec2(0, -2),
    });
    label.node.setPosition(iconSize / 2 + gap / 2, 2, 0);
  } else {
    if (opts.icon) {
      const iconSize = opts.iconSize ?? Math.round(h * 0.54);
      iconNode = makeIcon(n, opts.icon, iconSize);
      iconNode.setPosition(0, 1, 0);
    }
    if (opts.text) {
      label = makeLabel(n, opts.text, textSize, textColor, {
        width: w - 16,
        height: h,
        name: 'btn-label',
        display: opts.systemFont ? false : undefined,
        outlineColor: textOutline ?? undefined,
        outlineWidth: textOutline ? Math.max(2, Math.round(textSize * 0.09)) : undefined,
        shadowColor: textOutline ? new Color(0, 0, 0, 75) : undefined,
        shadowOffset: new Vec2(0, -2),
      });
      label.node.setPosition(0, 2, 0);
    }
  }

  let enabled = true;
  n.on(
    Node.EventType.TOUCH_START,
    () => {
      if (!enabled) return;
      n.setScale(1.03, 0.93, 1);
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
      setOpacity(n, v ? 255 : 135);
    },
    setVisible(v: boolean) {
      n.active = v;
    },
    repaintStyle(styleName: ButtonStyleName) {
      const st = BTN_STYLES[styleName];
      drawButtonGfx(g, w, h, radius, st.fill, st.top, st.bevel, st.outline, bevelH, gloss);
      if (label) {
        label.color = st.text;
        if (st.textOutline) {
          label.enableOutline = true;
          label.outlineColor = st.textOutline;
        } else {
          label.enableOutline = false;
        }
      }
    },
  };
}

export function popIn(node: Node, delay = 0): void {
  node.setScale(0.72, 0.72, 1);
  const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
  op.opacity = 0;
  tween(node)
    .delay(delay)
    .parallel(
      tween(node).to(0.28, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }),
      tween(op).to(0.18, { opacity: 255 }),
    )
    .start();
}

export function fadeIn(node: Node, duration = 0.18): void {
  const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
  op.opacity = 0;
  tween(op).to(duration, { opacity: 255 }).start();
}

export function bump(node: Node, scale = 1.14, duration = 0.14): void {
  tween(node)
    .to(duration / 2, { scale: new Vec3(scale, scale, 1) }, { easing: 'quadOut' })
    .to(duration / 2, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
    .start();
}

export function pulseIdle(node: Node, amplitude = 0.032, period = 1.6): void {
  tween(node)
    .repeatForever(
      tween(node)
        .to(period / 2, { scale: new Vec3(1 + amplitude, 1 + amplitude, 1) }, { easing: 'sineInOut' })
        .to(period / 2, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' }),
    )
    .start();
}
