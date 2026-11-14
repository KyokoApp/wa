//! Voxel world: blocks, chunk columns, procedural generation, player edits.

use crate::noise::{hash2, hash3, Noise};
use std::collections::HashMap;

pub const CH: i32 = 16; // chunk section width
pub const WORLD_H: i32 = 96; // world height (6 sections of 16)
pub const SEA: i32 = 40;
pub const SECTIONS_Y: i32 = WORLD_H / CH;

// ---- block ids (MUST match web/js/blocks.js) ----
pub const AIR: u8 = 0;
pub const STONE: u8 = 1;
pub const GRASS: u8 = 2;
pub const DIRT: u8 = 3;
pub const SAND: u8 = 4;
pub const WATER: u8 = 5;
pub const LOG: u8 = 6;
pub const LEAVES: u8 = 7;
pub const PLANKS: u8 = 8;
pub const COBBLE: u8 = 9;
pub const BRICK: u8 = 10;
pub const GLASS: u8 = 11;
pub const SNOW: u8 = 12;
pub const SANDSTONE: u8 = 13;
pub const GLOWSTONE: u8 = 14;
pub const GRAVEL: u8 = 15;
pub const COAL_ORE: u8 = 16;
pub const IRON_ORE: u8 = 17;
pub const DIAMOND_ORE: u8 = 18;
pub const TALL_GRASS: u8 = 19;
pub const FLOWER: u8 = 20;
pub const STONE_BRICKS: u8 = 21;
pub const BLOCK_COUNT: u8 = 22;

// ---- tile atlas ids (MUST match web/js/textures.js) ----
pub const T_GRASS_TOP: u16 = 0;
pub const T_GRASS_SIDE: u16 = 1;
pub const T_DIRT: u16 = 2;
pub const T_STONE: u16 = 3;
pub const T_SAND: u16 = 4;
pub const T_WATER: u16 = 5;
pub const T_LOG_SIDE: u16 = 6;
pub const T_LOG_TOP: u16 = 7;
pub const T_LEAVES: u16 = 8;
pub const T_PLANKS: u16 = 9;
pub const T_COBBLE: u16 = 10;
pub const T_BRICK: u16 = 11;
pub const T_GLASS: u16 = 12;
pub const T_SNOW: u16 = 13;
pub const T_SANDSTONE: u16 = 14;
pub const T_GLOWSTONE: u16 = 15;
pub const T_GRAVEL: u16 = 16;
pub const T_COAL: u16 = 17;
pub const T_IRON: u16 = 18;
pub const T_DIAMOND: u16 = 19;
pub const T_TALLGRASS: u16 = 20;
pub const T_FLOWER: u16 = 21;
pub const T_STONEBRICK: u16 = 22;

#[inline]
pub fn is_solid(b: u8) -> bool {
    b != AIR && b != WATER && b != TALL_GRASS && b != FLOWER
}

#[inline]
pub fn is_opaque(b: u8) -> bool {
    // full cube, hides the face behind it
    is_solid(b) && b != GLASS && b != LEAVES
}

#[inline]
pub fn is_cross(b: u8) -> bool {
    b == TALL_GRASS || b == FLOWER
}

/// does block `b` sitting next to a face hide that face?
#[inline]
pub fn occludes(neighbor: u8, self_id: u8) -> bool {
    if is_opaque(neighbor) {
        return true;
    }
    // glass & leaves cull against identical type to avoid interior faces
    neighbor == self_id && (neighbor == GLASS || neighbor == LEAVES)
}

/// tiles per face: [top, bottom, +X, -X, +Z, -Z]
pub fn block_tiles(id: u8) -> [u16; 6] {
    match id {
        GRASS => [T_GRASS_TOP, T_DIRT, T_GRASS_SIDE, T_GRASS_SIDE, T_GRASS_SIDE, T_GRASS_SIDE],
        DIRT => [T_DIRT; 6],
        STONE => [T_STONE; 6],
        SAND => [T_SAND; 6],
        WATER => [T_WATER; 6],
        LOG => [T_LOG_TOP, T_LOG_TOP, T_LOG_SIDE, T_LOG_SIDE, T_LOG_SIDE, T_LOG_SIDE],
        LEAVES => [T_LEAVES; 6],
        PLANKS => [T_PLANKS; 6],
        COBBLE => [T_COBBLE; 6],
        BRICK => [T_BRICK; 6],
        GLASS => [T_GLASS; 6],
        SNOW => [T_SNOW; 6],
        SANDSTONE => [T_SANDSTONE; 6],
        GLOWSTONE => [T_GLOWSTONE; 6],
        GRAVEL => [T_GRAVEL; 6],
        COAL_ORE => [T_COAL; 6],
        IRON_ORE => [T_IRON; 6],
        DIAMOND_ORE => [T_DIAMOND; 6],
        TALL_GRASS => [T_TALLGRASS; 6],
        FLOWER => [T_FLOWER; 6],
        STONE_BRICKS => [T_STONEBRICK; 6],
        _ => [T_STONE; 6],
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Biome {
    Ocean = 0,
    Beach = 1,
    Plains = 2,
    Forest = 3,
    Desert = 4,
    Mountains = 5,
}

pub struct Column {
    pub blocks: Vec<u8>, // 16*16*WORLD_H
}

impl Column {
    #[inline]
    pub fn idx(lx: i32, y: i32, lz: i32) -> usize {
        ((y * CH + lz) * CH + lx) as usize
    }
}

pub struct World {
    pub seed: u32,
    pub noise: Noise,
    pub cols: HashMap<(i32, i32), Column>,
    /// player edits per column: (packed local idx, block id)
    pub edits: HashMap<(i32, i32), Vec<(u16, u8)>>,
}

impl World {
    pub fn new(seed: u32) -> World {
        World {
            seed,
            noise: Noise::new(seed),
            cols: HashMap::new(),
            edits: HashMap::new(),
        }
    }

    // ---------- terrain shape ----------
    pub fn terrain_height(&self, x: i32, z: i32) -> i32 {
        let fx = x as f32;
        let fz = z as f32;
        let cont = self.noise.fbm2(fx * 0.0032, fz * 0.0032, 4);
        let hills = self.noise.fbm2(fx * 0.012 + 31.0, fz * 0.012 - 17.0, 3);
        let mtn = self
            .noise
            .fbm2(fx * 0.0016 + 100.0, fz * 0.0016 - 77.0, 3)
            .max(0.0);
        let h = SEA as f32 + 2.0 + cont * 14.0 + hills * 3.5 + mtn * mtn * 34.0;
        h as i32
    }

    pub fn biome_at(&self, x: i32, z: i32) -> Biome {
        let h = self.terrain_height(x, z);
        if h < SEA - 1 {
            return Biome::Ocean;
        }
        if h < SEA + 2 {
            return Biome::Beach;
        }
        if h > SEA + 26 {
            return Biome::Mountains;
        }
        let fx = x as f32;
        let fz = z as f32;
        let temp = self.noise.fbm2(fx * 0.0012 + 900.0, fz * 0.0012 - 500.0, 2);
        let humid = self.noise.fbm2(fx * 0.0015 - 800.0, fz * 0.0015 + 311.0, 2);
        if temp > 0.18 && humid < -0.02 {
            Biome::Desert
        } else if humid > 0.02 {
            Biome::Forest
        } else {
            Biome::Plains
        }
    }

    /// deterministic tree trunk height at a column, if any
    pub fn tree_at(&self, x: i32, z: i32) -> Option<u8> {
        let h = self.terrain_height(x, z);
        if h <= SEA + 1 || h > SEA + 24 {
            return None;
        }
        let biome = self.biome_at(x, z);
        let density: u64 = match biome {
            Biome::Forest => 32,
            Biome::Plains => 6,
            _ => 0,
        };
        if density == 0 {
            return None;
        }
        let r = hash2(self.seed ^ 0x7E57, x, z);
        if r % 1000 < density {
            Some(4 + ((r >> 12) % 3) as u8)
        } else {
            None
        }
    }

    // ---------- storage ----------
    #[inline]
    pub fn loaded(&self, cx: i32, cz: i32) -> bool {
        self.cols.contains_key(&(cx, cz))
    }

    pub fn ensure_column(&mut self, cx: i32, cz: i32) {
        if !self.cols.contains_key(&(cx, cz)) {
            let col = self.gen_column(cx, cz);
            self.cols.insert((cx, cz), col);
        }
    }

    /// raw lookup without generation (returns AIR if missing)
    #[inline]
    pub fn get(&self, x: i32, y: i32, z: i32) -> u8 {
        if y < 0 || y >= WORLD_H {
            return AIR;
        }
        if let Some(list) = self.edits.get(&(x >> 4, z >> 4)) {
            let packed = ((y * CH + (z & 15)) * CH + (x & 15)) as u16;
            for (k, v) in list.iter() {
                if *k == packed {
                    return *v;
                }
            }
        }
        match self.cols.get(&(x >> 4, z >> 4)) {
            Some(c) => c.blocks[Column::idx(x & 15, y, z & 15)],
            None => AIR,
        }
    }

    pub fn set(&mut self, x: i32, y: i32, z: i32, id: u8) {
        if y < 0 || y >= WORLD_H {
            return;
        }
        let key = (x >> 4, z >> 4);
        let packed = ((y * CH + (z & 15)) * CH + (x & 15)) as u16;
        let list = self.edits.entry(key).or_insert_with(Vec::new);
        if let Some(slot) = list.iter_mut().find(|(k, _)| *k == packed) {
            slot.1 = id;
        } else {
            list.push((packed, id));
        }
        // keep the live column (if any) consistent
        if let Some(c) = self.cols.get_mut(&key) {
            c.blocks[Column::idx(x & 15, y, z & 15)] = id;
        }
    }

    pub fn remove_column(&mut self, cx: i32, cz: i32) {
        self.cols.remove(&(cx, cz));
    }

    // ---------- generation ----------
    fn gen_column(&mut self, cx: i32, cz: i32) -> Column {
        let mut blocks = vec![0u8; (CH * CH * WORLD_H) as usize];
        let seed = self.seed;

        for lz in 0..CH {
            for lx in 0..CH {
                let x = cx * CH + lx;
                let z = cz * CH + lz;
                let h = self.terrain_height(x, z);
                let biome = self.biome_at(x, z);

                for y in 0..=h.min(WORLD_H - 1) {
                    let mut b = STONE;
                    if y == 0 {
                        b = STONE; // bedrock-ish floor
                    } else if y > h - 4 {
                        b = match biome {
                            Biome::Desert | Biome::Beach => SAND,
                            Biome::Mountains => {
                                if y >= h - 1 && h > SEA + 22 {
                                    SNOW
                                } else if y >= h - 1 {
                                    GRASS
                                } else {
                                    STONE
                                }
                            }
                            Biome::Ocean => {
                                if y >= h - 3 {
                                    SAND
                                } else {
                                    STONE
                                }
                            }
                            _ => {
                                if y == h {
                                    GRASS
                                } else {
                                    DIRT
                                }
                            }
                        };
                    } else if biome == Biome::Desert {
                        b = SANDSTONE;
                    }

                    // ore sprinkles inside stone
                    if b == STONE && y > 1 {
                        let r = hash3(seed ^ 0x0E20, x, y, z);
                        let m = r % 100_000;
                        if y < 14 && m < 25 {
                            b = DIAMOND_ORE;
                        } else if y < 30 && m < 90 {
                            b = IRON_ORE;
                        } else if y < 48 && m < 220 {
                            b = COAL_ORE;
                        } else if y > 6 && m >= 220 && m < 420 {
                            b = GRAVEL;
                        }
                    }

                    // caves
                    if y > 1 && y < h - 2 && y < 52 {
                        let c = self.noise.fbm3(
                            x as f32 * 0.055,
                            y as f32 * 0.075,
                            z as f32 * 0.055,
                            3,
                        );
                        if c > 0.52 {
                            b = AIR;
                        }
                    }

                    blocks[Column::idx(lx, y, lz)] = b;
                }

                // water fill up to sea level
                if h < SEA {
                    for y in (h + 1)..=SEA {
                        blocks[Column::idx(lx, y, lz)] = WATER;
                    }
                }

                // desert sandstone cap edge softening: sand above sandstone handled above.
                let _ = seed;
            }
        }

        // ---- decorations: trees from all source columns that can overlap us ----
        for tz in (cz * CH - 2)..=(cz * CH + CH + 1) {
            for tx in (cx * CH - 2)..=(cx * CH + CH + 1) {
                if let Some(th) = self.tree_at(tx, tz) {
                    let base = self.terrain_height(tx, tz);
                    // leaves
                    for ly in -1i32..=2 {
                        let ly_abs = base + th as i32 + ly;
                        let radius: i32 = match ly {
                            -1 => 2,
                            0 => 2,
                            1 => 1,
                            _ => 1,
                        };
                        for lz in -radius..=radius {
                            for lx in -radius..=radius {
                                if ly >= 0 && lx.abs() == radius && lz.abs() == radius {
                                    continue; // trim corners
                                }
                                if ly == 2 && (lx.abs() + lz.abs()) > 1 {
                                    continue;
                                }
                                let px = tx + lx;
                                let pz = tz + lz;
                                let lx0 = px - cx * CH;
                                let lz0 = pz - cz * CH;
                                if lx0 < 0 || lx0 >= CH || lz0 < 0 || lz0 >= CH {
                                    continue;
                                }
                                if ly_abs < 1 || ly_abs >= WORLD_H {
                                    continue;
                                }
                                let idx = Column::idx(lx0, ly_abs, lz0);
                                if blocks[idx] == AIR {
                                    blocks[idx] = LEAVES;
                                }
                            }
                        }
                    }
                    // trunk
                    for ly in 1..=th as i32 {
                        let lx0 = tx - cx * CH;
                        let lz0 = tz - cz * CH;
                        if lx0 < 0 || lx0 >= CH || lz0 < 0 || lz0 >= CH {
                            continue;
                        }
                        let y = base + ly;
                        if y >= 1 && y < WORLD_H {
                            blocks[Column::idx(lx0, y, lz0)] = LOG;
                        }
                    }
                }
            }
        }

        // ---- grass & flowers on own columns ----
        for lz in 0..CH {
            for lx in 0..CH {
                let x = cx * CH + lx;
                let z = cz * CH + lz;
                let h = self.terrain_height(x, z);
                if h + 1 >= WORLD_H {
                    continue;
                }
                let idx = Column::idx(lx, h, lz);
                if blocks[idx] != GRASS {
                    continue;
                }
                let biome = self.biome_at(x, z);
                if !matches!(biome, Biome::Plains | Biome::Forest) {
                    continue;
                }
                let r = hash2(seed ^ 0xF10A, x, z) % 1000;
                let above = Column::idx(lx, h + 1, lz);
                if blocks[above] == AIR {
                    if r < 130 {
                        blocks[above] = TALL_GRASS;
                    } else if r < 155 {
                        blocks[above] = FLOWER;
                    }
                }
            }
        }

        // ---- apply player edits for this column ----
        if let Some(list) = self.edits.get(&(cx, cz)) {
            for (packed, id) in list.iter() {
                let packed = *packed as usize;
                let lx = packed % CH as usize;
                let lz = (packed / CH as usize) % CH as usize;
                let y = packed / (CH * CH) as usize;
                blocks[Column::idx(lx as i32, y as i32, lz as i32)] = *id;
            }
        }

        Column { blocks }
    }
}
