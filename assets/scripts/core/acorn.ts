/** 35×44 acorn silhouette from the reference Arrows Out demo. */
export const ACORN_COLS = 35;
export const ACORN_ROWS = 44;

export function acornMask(): Uint8Array {
  const mask = new Uint8Array(ACORN_COLS * ACORN_ROWS);
  const cx = Math.floor(ACORN_COLS / 2);

  for (let y = 0; y < ACORN_ROWS; y++) {
    for (let x = 0; x < ACORN_COLS; x++) {
      const dx = x - cx;
      let on = false;
      if (y >= 1 && y <= 4) {
        on =
          (y === 1 && dx === 0) ||
          ((y === 2 || y === 3) && (dx === -1 || dx === 0)) ||
          (y === 4 && (dx === 0 || dx === 1));
      } else if (y >= 5 && y <= 15) {
        const ny = (15.3 - y) / 10.6;
        const halfWidth = Math.round(15.2 * Math.pow(Math.max(0, 1 - Math.pow(ny, 1.85)), 0.46));
        on = Math.abs(dx) <= halfWidth;
      } else if (y >= 18 && y <= 39) {
        const t = (y - 18) / 21.0;
        const halfWidth = Math.round(11.5 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.75)), 0.58));
        on = Math.abs(dx) <= halfWidth;
      }
      if (on) mask[y * ACORN_COLS + x] = 1;
    }
  }
  return mask;
}
