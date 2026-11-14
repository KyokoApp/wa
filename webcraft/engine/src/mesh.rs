//! Chunk section meshing: face culling, per-vertex ambient occlusion, water & plants.

use crate::world::*;

pub struct MeshData {
    pub verts: Vec<u8>, // 24 bytes per vertex: pos f32*3, uv f32*2, light u8*4
    pub idx: Vec<u32>,
}

impl MeshData {
    pub fn new() -> MeshData {
        MeshData {
            verts: Vec::new(),
            idx: Vec::new(),
        }
    }
    #[inline]
    fn vert(&mut self, x: f32, y: f32, z: f32, u: f32, v: f32, r: u8, g: u8, b: u8, a: u8) {
        self.verts.extend_from_slice(&x.to_le_bytes());
        self.verts.extend_from_slice(&y.to_le_bytes());
        self.verts.extend_from_slice(&z.to_le_bytes());
        self.verts.extend_from_slice(&u.to_le_bytes());
        self.verts.extend_from_slice(&v.to_le_bytes());
        self.verts.push(r);
        self.verts.push(g);
        self.verts.push(b);
        self.verts.push(a);
    }
    #[inline]
    fn quad(&mut self, base: u32, flip: bool) {
        if flip {
            self.idx.extend_from_slice(&[base + 1, base + 2, base + 3, base + 1, base + 3, base]);
        } else {
            self.idx.extend_from_slice(&[base, base + 1, base + 2, base + 2, base + 1, base + 3]);
        }
    }
}

struct Face {
    dir: [i32; 3],
    shade: u8,
    corners: [[f32; 3]; 4],
    uvs: [[f32; 2]; 4],
}

/// face order: 0 +Y, 1 -Y, 2 +X, 3 -X, 4 +Z, 5 -Z  (matches tile table & JS)
const FACES: [Face; 6] = [
    Face {
        dir: [0, 1, 0],
        shade: 255,
        corners: [[0.0, 1.0, 1.0], [1.0, 1.0, 1.0], [0.0, 1.0, 0.0], [1.0, 1.0, 0.0]],
        uvs: [[1.0, 1.0], [0.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
    },
    Face {
        dir: [0, -1, 0],
        shade: 150,
        corners: [[1.0, 0.0, 1.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
        uvs: [[1.0, 0.0], [0.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
    },
    Face {
        dir: [1, 0, 0],
        shade: 180,
        corners: [[1.0, 1.0, 1.0], [1.0, 0.0, 1.0], [1.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
        uvs: [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
    },
    Face {
        dir: [-1, 0, 0],
        shade: 180,
        corners: [[0.0, 1.0, 0.0], [0.0, 0.0, 0.0], [0.0, 1.0, 1.0], [0.0, 0.0, 1.0]],
        uvs: [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
    },
    Face {
        dir: [0, 0, 1],
        shade: 210,
        corners: [[0.0, 0.0, 1.0], [1.0, 0.0, 1.0], [0.0, 1.0, 1.0], [1.0, 1.0, 1.0]],
        uvs: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
    },
    Face {
        dir: [0, 0, -1],
        shade: 210,
        corners: [[1.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 1.0, 0.0], [0.0, 1.0, 0.0]],
        uvs: [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
    },
];

const ATLAS: f32 = 256.0;
const TILE: f32 = 16.0;

/// uv rect of a tile (inset by half texel), v1 = top of tile in GL space
#[inline]
fn tile_uv(tile: u16) -> (f32, f32, f32, f32) {
    let tx = (tile % 16) as f32;
    let ty = (tile / 16) as f32;
    let u0 = (tx * TILE + 0.5) / ATLAS;
    let u1 = (tx * TILE + TILE - 0.5) / ATLAS;
    // atlas uploaded with UNPACK_FLIP_Y: canvas top row -> v=1
    let v1 = 1.0 - (ty * TILE + 0.5) / ATLAS;
    let v0 = 1.0 - (ty * TILE + TILE - 0.5) / ATLAS;
    (u0, v0, u1, v1)
}

#[inline]
fn ao_value(s1: bool, s2: bool, c: bool) -> u8 {
    let a = if s1 && s2 {
        0u8
    } else {
        3 - (s1 as u8 + s2 as u8 + c as u8)
    };
    a * 85
}

/// ambient occlusion at one corner of a face
fn corner_ao(world: &World, x: i32, y: i32, z: i32, dir: [i32; 3], corner: [f32; 3]) -> u8 {
    // tangent axes = the two axes that are not the normal axis
    let mut axes = [0usize; 2];
    let mut n_axis = 0usize;
    for a in 0..3 {
        if dir[a] != 0 {
            n_axis = a;
        }
    }
    let mut k = 0;
    for a in 0..3 {
        if a != n_axis {
            axes[k] = a;
            k += 1;
        }
    }
    let mut s1 = [0i32; 3];
    let mut s2 = [0i32; 3];
    let mut sc = [0i32; 3];
    s1[n_axis] = dir[n_axis];
    s2[n_axis] = dir[n_axis];
    sc[n_axis] = dir[n_axis];
    let sa = if corner[axes[0]] > 0.5 { 1 } else { -1 };
    let sb = if corner[axes[1]] > 0.5 { 1 } else { -1 };
    s1[axes[0]] = sa;
    s2[axes[1]] = sb;
    sc[axes[0]] = sa;
    sc[axes[1]] = sb;

    let b1 = is_opaque(world.get(x + s1[0], y + s1[1], z + s1[2]));
    let b2 = is_opaque(world.get(x + s2[0], y + s2[1], z + s2[2]));
    let bc = is_opaque(world.get(x + sc[0], y + sc[1], z + sc[2]));
    ao_value(b1, b2, bc)
}

/// Build opaque + water meshes for one 16^3 section.
pub fn build_section(
    world: &World,
    cx: i32,
    cy: i32,
    cz: i32,
    smooth: bool,
) -> (MeshData, MeshData) {
    let mut opaque = MeshData::new();
    let mut water = MeshData::new();

    let x0 = cx * CH;
    let y0 = cy * CH;
    let z0 = cz * CH;

    for ly in 0..CH {
        for lz in 0..CH {
            for lx in 0..CH {
                let x = x0 + lx;
                let y = y0 + ly;
                let z = z0 + lz;
                let b = world.get(x, y, z);
                if b == AIR {
                    continue;
                }
                let wave: u8 = if b == WATER {
                    2
                } else if b == LEAVES || is_cross(b) {
                    1
                } else {
                    0
                };
                let emissive: u8 = if b == GLOWSTONE { 255 } else { 0 };

                if is_cross(b) {
                    // two diagonal quads, double sided
                    let (u0, v0, u1, v1) = tile_uv(block_tiles(b)[0]);
                    for dir in 0..2 {
                        let (ax, az, bx, bz) = if dir == 0 {
                            (0.15f32, 0.15f32, 0.85f32, 0.85f32)
                        } else {
                            (0.85f32, 0.15f32, 0.15f32, 0.85f32)
                        };
                        for flip in [false, true] {
                            let base = (opaque.verts.len() / 24) as u32;
                            let corners = [
                                (ax, 0.0, az, u0, v0),
                                (bx, 0.0, bz, u1, v0),
                                (ax, 1.0, az, u0, v1),
                                (bx, 1.0, bz, u1, v1),
                            ];
                            for (px, py, pz, uu, vv) in corners {
                                opaque.vert(
                                    lx as f32 + px,
                                    ly as f32 + py,
                                    lz as f32 + pz,
                                    uu,
                                    vv,
                                    255,
                                    255,
                                    emissive,
                                    wave,
                                );
                            }
                            opaque.quad(base, flip);
                        }
                    }
                    continue;
                }

                let tiles = block_tiles(b);
                for fi in 0..6 {
                    let face = &FACES[fi];
                    let nx = x + face.dir[0];
                    let ny = y + face.dir[1];
                    let nz = z + face.dir[2];
                    let nb = world.get(nx, ny, nz);
                    if occludes(nb, b) {
                        continue;
                    }
                    if b == WATER {
                        // water renders only against air-ish neighbors
                        if nb == WATER || is_opaque(nb) {
                            continue;
                        }
                    } else if nb == WATER {
                        // solid faces adjacent to water still draw
                    }
                    let (u0, v0, u1, v1) = tile_uv(tiles[fi]);
                    let is_water = b == WATER;
                    let target = if is_water { &mut water } else { &mut opaque };
                    let base = (target.verts.len() / 24) as u32;

                    // lowered top surface for water
                    let y_off = if is_water && fi == 0 { -0.125 } else { 0.0 };

                    let mut aos = [255u8; 4];
                    if smooth && !is_water {
                        for ci in 0..4 {
                            aos[ci] = corner_ao(world, x, y, z, face.dir, face.corners[ci]);
                        }
                    }
                    for ci in 0..4 {
                        let c = face.corners[ci];
                        let uv = face.uvs[ci];
                        let uu = u0 + uv[0] * (u1 - u0);
                        let vv = v0 + uv[1] * (v1 - v0);
                        target.vert(
                            lx as f32 + c[0],
                            ly as f32 + c[1] + y_off,
                            lz as f32 + c[2],
                            uu,
                            vv,
                            face.shade,
                            aos[ci],
                            emissive,
                            wave,
                        );
                    }
                    // anisotropy-aware triangulation
                    let flip = aos[0] as u32 + aos[3] as u32 > aos[1] as u32 + aos[2] as u32;
                    target.quad(base, flip);
                }
            }
        }
    }
    (opaque, water)
}
