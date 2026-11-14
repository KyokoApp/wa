// Procedural pixel-art texture atlas (256x256, 16px tiles) + isometric block icons.
// Tile indices MUST match engine/src/world.rs (T_* constants).

const TILE = 16, ATLAS = 256;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function px(img, x, y, r, g, b, a = 255) {
  const i = (y * TILE + x) * 4;
  img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
}

function noiseFill(img, rng, r, g, b, vary, alpha = 255) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = (rng() - 0.5) * 2 * vary;
      px(img, x, y, r + n, g + n, b + n, alpha);
    }
  }
}

function blobs(img, rng, r, g, b, count, size, alpha = 255) {
  for (let i = 0; i < count; i++) {
    const bx = Math.floor(rng() * TILE), by = Math.floor(rng() * TILE);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (rng() < 0.72) px(img, (bx + dx) % TILE, (by + dy) % TILE, r, g, b, alpha);
      }
    }
  }
}

const PAINTERS = {
  0(img, rng) { // grass_top
    noiseFill(img, rng, 106, 172, 66, 16);
    blobs(img, rng, 88, 150, 52, 6, 2);
    blobs(img, rng, 124, 190, 82, 5, 2);
  },
  1(img, rng) { // grass_side
    noiseFill(img, rng, 135, 96, 67, 15);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(rng() * 3);
      for (let y = 0; y < depth; y++) {
        const n = (rng() - 0.5) * 24;
        px(img, x, y, 100 + n, 168 + n, 62 + n);
      }
    }
  },
  2(img, rng) { // dirt
    noiseFill(img, rng, 135, 96, 67, 16);
    blobs(img, rng, 112, 78, 52, 5, 2);
    blobs(img, rng, 156, 116, 82, 4, 2);
  },
  3(img, rng) { // stone
    noiseFill(img, rng, 126, 126, 130, 12);
    blobs(img, rng, 104, 104, 108, 6, 3);
    blobs(img, rng, 148, 148, 152, 4, 2);
  },
  4(img, rng) { // sand
    noiseFill(img, rng, 222, 210, 165, 11);
    blobs(img, rng, 206, 192, 148, 4, 2);
  },
  5(img, rng) { // water
    noiseFill(img, rng, 52, 108, 218, 8, 168);
    for (let y = 2; y < TILE; y += 5) {
      for (let x = 0; x < TILE; x++) {
        if (((x + y) % 7) < 3) px(img, x, y, 92, 150, 238, 190);
      }
    }
  },
  6(img, rng) { // log_side
    noiseFill(img, rng, 118, 90, 55, 11);
    for (let x = 0; x < TILE; x++) {
      if (x % 4 === 0) for (let y = 0; y < TILE; y++) px(img, x, y, 96, 72, 42);
      if (x % 4 === 2) for (let y = 0; y < TILE; y++) px(img, x, y, 138, 106, 66);
    }
  },
  7(img, rng) { // log_top
    noiseFill(img, rng, 152, 120, 76, 10);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (Math.floor(d) % 3 === 1) px(img, x, y, 118, 90, 54);
      }
    }
  },
  8(img, rng) { // leaves
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = rng();
        if (v < 0.07) { px(img, x, y, 0, 0, 0, 0); continue; }
        const n = (rng() - 0.5) * 30;
        px(img, x, y, 52 + n, 128 + n, 42 + n);
      }
    }
    blobs(img, rng, 76, 158, 58, 4, 2);
  },
  9(img, rng) { // planks
    noiseFill(img, rng, 162, 128, 76, 9);
    for (let y = 3; y < TILE; y += 4) {
      for (let x = 0; x < TILE; x++) px(img, x, y, 118, 90, 52);
    }
    for (let row = 0; row < 4; row++) {
      const jx = row % 2 === 0 ? 5 : 11;
      for (let y = row * 4; y < row * 4 + 3; y++) px(img, jx, y, 130, 100, 60);
    }
  },
  10(img, rng) { // cobble
    noiseFill(img, rng, 118, 118, 122, 14);
    blobs(img, rng, 88, 88, 92, 8, 3);
    blobs(img, rng, 148, 148, 152, 6, 3);
  },
  11(img, rng) { // brick
    noiseFill(img, rng, 168, 158, 150, 6);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 === 0 ? 0 : 4;
      for (let bx = -4; bx < TILE; bx += 8) {
        for (let y = row * 4; y < row * 4 + 3; y++) {
          for (let x = bx + off; x < bx + off + 7; x++) {
            if (x >= 0 && x < TILE) {
              const n = (rng() - 0.5) * 18;
              px(img, x, y, 152 + n, 72 + n, 56 + n);
            }
          }
        }
      }
    }
  },
  12(img, rng) { // glass
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(img, x, y, 0, 0, 0, 0);
    for (let i = 0; i < TILE; i++) {
      px(img, i, 0, 196, 226, 238, 120); px(img, i, 15, 196, 226, 238, 120);
      px(img, 0, i, 196, 226, 238, 120); px(img, 15, i, 196, 226, 238, 120);
    }
    for (let i = 2; i < 10; i++) px(img, i, 12 - i, 220, 240, 250, 80);
    for (let i = 4; i < 12; i++) px(img, i, 18 - i, 220, 240, 250, 50);
  },
  13(img, rng) { // snow
    noiseFill(img, rng, 242, 248, 252, 7);
    blobs(img, rng, 226, 238, 248, 3, 2);
  },
  14(img, rng) { // sandstone
    noiseFill(img, rng, 218, 205, 158, 9);
    for (let y = 2; y < TILE; y += 5) for (let x = 0; x < TILE; x++) px(img, x, y, 196, 182, 138);
  },
  15(img, rng) { // glowstone
    noiseFill(img, rng, 252, 210, 116, 16);
    blobs(img, rng, 255, 240, 178, 7, 2);
    blobs(img, rng, 226, 172, 88, 5, 2);
  },
  16(img, rng) { // gravel
    noiseFill(img, rng, 128, 122, 118, 20);
    blobs(img, rng, 92, 86, 82, 7, 2);
    blobs(img, rng, 158, 152, 146, 6, 2);
    blobs(img, rng, 110, 100, 96, 5, 3);
  },
  17(img, rng) { // coal ore
    PAINTERS[3](img, rng);
    blobs(img, rng, 34, 32, 34, 4, 3);
    blobs(img, rng, 58, 56, 58, 3, 2);
  },
  18(img, rng) { // iron ore
    PAINTERS[3](img, rng);
    blobs(img, rng, 208, 168, 118, 4, 3);
    blobs(img, rng, 232, 196, 148, 3, 2);
  },
  19(img, rng) { // diamond ore
    PAINTERS[3](img, rng);
    blobs(img, rng, 110, 224, 234, 4, 3);
    blobs(img, rng, 168, 240, 246, 3, 2);
  },
  20(img, rng) { // tall grass (cross)
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(img, x, y, 0, 0, 0, 0);
    for (let i = 0; i < 9; i++) {
      const bx = 1 + Math.floor(rng() * 14);
      const h = 6 + Math.floor(rng() * 9);
      for (let y = TILE - 1; y > TILE - 1 - h; y--) {
        const n = (rng() - 0.5) * 24;
        px(img, bx + (y % 3 === 0 ? 1 : 0), y, 78 + n, 148 + n, 48 + n);
      }
    }
  },
  21(img, rng) { // poppy (cross)
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(img, x, y, 0, 0, 0, 0);
    for (let y = 6; y < TILE; y++) px(img, 8, y, 64, 128, 46);
    px(img, 7, 10, 64, 128, 46); px(img, 9, 12, 64, 128, 46);
    const petals = [[6, 4], [7, 3], [8, 3], [9, 3], [10, 4], [6, 5], [10, 5], [7, 5], [8, 5], [9, 5], [8, 4]];
    for (const [x, y] of petals) px(img, x, y, 212, 52, 44);
    px(img, 8, 4, 250, 210, 70);
  },
  22(img, rng) { // stone bricks
    noiseFill(img, rng, 118, 118, 122, 8);
    for (let y = 3; y < TILE; y += 4) for (let x = 0; x < TILE; x++) px(img, x, y, 88, 88, 92);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 === 0 ? 7 : 15;
      for (let y = row * 4; y < row * 4 + 3; y++) {
        px(img, off % TILE, y, 88, 88, 92);
        px(img, (off + 8) % TILE, y, 88, 88, 92);
      }
    }
    blobs(img, rng, 138, 138, 142, 3, 2);
  },
};

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS; canvas.height = ATLAS;
  const ctx = canvas.getContext('2d');
  for (let tile = 0; tile < 24; tile++) {
    const img = new Uint8ClampedArray(TILE * TILE * 4);
    const rng = mulberry32(0xA71A5 + tile * 7919);
    (PAINTERS[tile] || PAINTERS[3])(img, rng);
    const idata = new ImageData(img, TILE, TILE);
    ctx.putImageData(idata, (tile % 16) * TILE, Math.floor(tile / 16) * TILE);
  }
  return canvas;
}

function tileCanvas(tile) {
  const c = document.createElement('canvas');
  c.width = TILE; c.height = TILE;
  const img = new Uint8ClampedArray(TILE * TILE * 4);
  const rng = mulberry32(0xA71A5 + tile * 7919);
  (PAINTERS[tile] || PAINTERS[3])(img, rng);
  c.getContext('2d').putImageData(new ImageData(img, TILE, TILE), 0, 0);
  return c;
}

/** isometric cube icon data-url for hotbar / inventory */
export function blockIconURL(blockId, faceTiles) {
  const size = 48;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const [topTile, , sideTileA, , sideTileB] = faceTiles;
  const top = tileCanvas(topTile), sideA = tileCanvas(sideTileA), sideB = tileCanvas(sideTileB);
  // cross blocks: draw flat
  if (blockId === 19 || blockId === 20) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tileCanvas(faceTiles[0]), 4, 4, 40, 40);
    return c.toDataURL();
  }
  ctx.imageSmoothingEnabled = false;
  // top face
  ctx.save();
  ctx.setTransform(20 / 16, -11 / 16, 20 / 16, 11 / 16, 4, 15);
  ctx.drawImage(top, 0, 0);
  ctx.restore();
  // left face
  ctx.save();
  ctx.setTransform(20 / 16, 11 / 16, 0, 18 / 16, 4, 15);
  ctx.drawImage(sideA, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.restore();
  // right face
  ctx.save();
  ctx.setTransform(20 / 16, -11 / 16, 0, 18 / 16, 24, 26);
  ctx.drawImage(sideB, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, 16, 16);
  ctx.restore();
  return c.toDataURL();
}
