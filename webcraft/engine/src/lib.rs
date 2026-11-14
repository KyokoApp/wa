//! RustCraft engine — Rust core compiled to WebAssembly (wasm32-unknown-unknown).
//!
//! Custom C ABI (no wasm-bindgen needed): JS drives rendering & input, Rust owns
//! world simulation, chunk streaming, meshing and physics. See web/js/engine.js
//! for the mirror of these contracts.

mod mesh;
mod noise;
mod physics;
mod world;

use physics::{Hit, Input, Player};
use std::collections::HashMap;
use world::{World, AIR, SECTIONS_Y, WATER};

/// JS-provided clock import (performance.now()/1000).
mod host {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn host_now() -> f64;
    }
    pub fn now() -> f64 {
        unsafe { host_now() }
    }
}

pub const INPUT_BYTES: usize = 32;
pub const STATE_WORDS: usize = 20;

struct SectionRec {
    id: u32,
    opaque: mesh::MeshData,
    water: mesh::MeshData,
    built: bool,
    need_mesh: bool,
    dirty_queued: bool,
}

pub struct Game {
    world: World,
    player: Player,
    slots: [u8; 9],
    view: i32,
    smooth: bool,
    sections: HashMap<(i32, i32, i32), SectionRec>,
    id_map: HashMap<u32, (i32, i32, i32)>,
    next_id: u32,
    dirty: Vec<u32>,
    unloads: Vec<u32>,
    target: Hit,
    current_slot: u32,
}

#[inline]
fn is_replaceable(b: u8) -> bool {
    b == AIR || b == WATER || world::is_cross(b)
}

impl Game {
    fn new(seed: u32, view: u32, smooth: bool) -> Game {
        let mut world = World::new(seed);
        let h = world.terrain_height(8, 8);
        let player = Player::new(8.5, (h + 2) as f32, 8.5);
        world.ensure_column(0, 0);
        Game {
            world,
            player,
            slots: [2, 3, 1, 9, 8, 6, 7, 4, 11],
            view: view.clamp(2, 12) as i32,
            smooth,
            sections: HashMap::new(),
            id_map: HashMap::new(),
            next_id: 1,
            dirty: Vec::new(),
            unloads: Vec::new(),
            target: Hit::none(),
            current_slot: 0,
        }
    }

    fn mark_dirty(&mut self, x: i32, y: i32, z: i32) {
        let sx = x >> 4;
        let sy = y >> 4;
        let sz = z >> 4;
        let mut keys: Vec<(i32, i32, i32)> = vec![(sx, sy, sz)];
        if x & 15 == 0 {
            keys.push((sx - 1, sy, sz));
        }
        if x & 15 == 15 {
            keys.push((sx + 1, sy, sz));
        }
        if y & 15 == 0 && sy > 0 {
            keys.push((sx, sy - 1, sz));
        }
        if y & 15 == 15 && sy < SECTIONS_Y - 1 {
            keys.push((sx, sy + 1, sz));
        }
        if z & 15 == 0 {
            keys.push((sx, sy, sz - 1));
        }
        if z & 15 == 15 {
            keys.push((sx, sy, sz + 1));
        }
        for key in keys {
            if let Some(rec) = self.sections.get_mut(&key) {
                rec.need_mesh = true;
                if !rec.dirty_queued {
                    rec.dirty_queued = true;
                    let id = rec.id;
                    self.dirty.push(id);
                }
            }
        }
    }

    fn set_block(&mut self, x: i32, y: i32, z: i32, id: u8) {
        self.world.set(x, y, z, id);
        self.mark_dirty(x, y, z);
    }

    fn tick(&mut self, inp: &Input) {
        // make sure the columns we physically touch exist
        let pcx = (self.player.pos[0].floor() as i32) >> 4;
        let pcz = (self.player.pos[2].floor() as i32) >> 4;
        for dz in -1..=1 {
            for dx in -1..=1 {
                self.world.ensure_column(pcx + dx, pcz + dz);
            }
        }

        self.player.step(&mut self.world, inp);

        // look ray from the eye
        let dir = Player::look_dir(inp.yaw, inp.pitch);
        let eye = [
            self.player.pos[0],
            self.player.pos[1] + physics::EYE,
            self.player.pos[2],
        ];
        self.target = physics::raycast(
            &mut self.world,
            eye[0],
            eye[1],
            eye[2],
            dir[0],
            dir[1],
            dir[2],
            7.0,
        );

        // break (creative: instant on press or hold)
        if inp.flags & (physics::F_BREAK_PRESS | physics::F_BREAK_HELD) != 0
            && self.target.face != 255
        {
            let (x, y, z) = (self.target.x, self.target.y, self.target.z);
            if y > 0 {
                self.set_block(x, y, z, AIR);
                self.target = Hit::none();
            }
        }

        // place
        if inp.flags & physics::F_PLACE_PRESS != 0 && self.target.face != 255 {
            let (px, py, pz) = self.target.place_pos();
            if py >= 1 && py < world::WORLD_H {
                let cur = self.world.get(px, py, pz);
                if is_replaceable(cur) && !self.player.intersects_block(px, py, pz) {
                    let id = self.slots[self.current_slot as usize % 9];
                    if id != AIR {
                        self.set_block(px, py, pz, id);
                    }
                }
            }
        }
    }

    fn update_chunks(&mut self, budget_ms: f32) -> u32 {
        let t0 = host::now();
        let budget = budget_ms.max(0.5) as f64 / 1000.0;
        let pcx = (self.player.pos[0].floor() as i32) >> 4;
        let pcz = (self.player.pos[2].floor() as i32) >> 4;
        let view = self.view;

        // ---- unload distant columns ----
        let mut rm: Vec<(i32, i32)> = Vec::new();
        for k in self.world.cols.keys() {
            if (k.0 - pcx).abs() > view + 2 || (k.1 - pcz).abs() > view + 2 {
                rm.push(*k);
            }
        }
        for k in rm {
            self.world.remove_column(k.0, k.1);
            for cy in 0..SECTIONS_Y {
                if let Some(rec) = self.sections.remove(&(k.0, cy, k.1)) {
                    self.unloads.push(rec.id);
                    self.id_map.remove(&rec.id);
                }
            }
        }

        // ---- generate missing columns (nearest first) ----
        let mut need_cols: Vec<(i32, i32)> = Vec::new();
        for dz in -view..=view {
            for dx in -view..=view {
                let cx = pcx + dx;
                let cz = pcz + dz;
                if !self.world.loaded(cx, cz) {
                    need_cols.push((cx, cz));
                }
            }
        }
        need_cols.sort_by_key(|(cx, cz)| {
            let dx = cx - pcx;
            let dz = cz - pcz;
            dx * dx + dz * dz
        });
        let mut gen_done = 0;
        for (cx, cz) in need_cols.iter() {
            if host::now() - t0 > budget {
                break;
            }
            self.world.ensure_column(*cx, *cz);
            gen_done += 1;
        }

        // ---- mesh sections that need it (nearest first) ----
        let mut need_secs: Vec<(i32, i32, i32)> = Vec::new();
        for dz in -view..=view {
            for dx in -view..=view {
                let cx = pcx + dx;
                let cz = pcz + dz;
                if !self.world.loaded(cx, cz) {
                    continue;
                }
                for cy in 0..SECTIONS_Y {
                    let key = (cx, cy, cz);
                    let need = match self.sections.get(&key) {
                        None => true,
                        Some(r) => r.need_mesh,
                    };
                    if need {
                        need_secs.push(key);
                    }
                }
            }
        }
        need_secs.sort_by_key(|(cx, cy, cz)| {
            let dx = cx - pcx;
            let dz = cz - pcz;
            dx * dx + dz * dz + cy * cy
        });
        let mut mesh_done = 0;
        for key in need_secs.iter() {
            if host::now() - t0 > budget {
                break;
            }
            // border faces need neighbor columns
            for dz in -1..=1 {
                for dx in -1..=1 {
                    self.world.ensure_column(key.0 + dx, key.2 + dz);
                }
            }
            let (o, w) = mesh::build_section(&self.world, key.0, key.1, key.2, self.smooth);
            if !self.sections.contains_key(key) {
                let id = self.next_id;
                self.next_id += 1;
                self.sections.insert(
                    *key,
                    SectionRec {
                        id,
                        opaque: mesh::MeshData::new(),
                        water: mesh::MeshData::new(),
                        built: false,
                        need_mesh: true,
                        dirty_queued: false,
                    },
                );
                self.id_map.insert(id, *key);
            }
            let rec = self.sections.get_mut(key).unwrap();
            rec.opaque = o;
            rec.water = w;
            rec.built = true;
            rec.need_mesh = false;
            if !rec.dirty_queued {
                rec.dirty_queued = true;
                let id = rec.id;
                self.dirty.push(id);
            }
            mesh_done += 1;
        }

        // ---- pending estimate ----
        let mut pending = 0u32;
        for dz in -view..=view {
            for dx in -view..=view {
                let cx = pcx + dx;
                let cz = pcz + dz;
                if !self.world.loaded(cx, cz) {
                    pending += 1;
                    continue;
                }
                for cy in 0..SECTIONS_Y {
                    match self.sections.get(&(cx, cy, cz)) {
                        None => pending += 1,
                        Some(r) => {
                            if r.need_mesh {
                                pending += 1
                            }
                        }
                    }
                }
            }
        }
        let _ = (gen_done, mesh_done);
        pending
    }
}

// ---------------------------------------------------------------- ABI helpers

#[inline]
unsafe fn game_mut(g: u32) -> &'static mut Game {
    &mut *(g as *mut Game)
}

// (host_now is a wasm import provided by the JS runtime, see module `host`)

#[inline]
unsafe fn wu32(out: u32, i: usize, v: u32) {
    *((out as usize + i * 4) as *mut u32) = v;
}

#[inline]
unsafe fn wf32(out: u32, i: usize, v: f32) {
    *((out as usize + i * 4) as *mut f32) = v;
}

#[inline]
unsafe fn ru32(ptr: u32, i: usize) -> u32 {
    *((ptr as usize + i * 4) as *const u32)
}

#[inline]
unsafe fn rf32(ptr: u32, i: usize) -> f32 {
    *((ptr as usize + i * 4) as *const f32)
}

// ------------------------------------------------------------------- exports

#[no_mangle]
pub extern "C" fn alloc(size: u32) -> u32 {
    let mut v: Vec<u8> = Vec::with_capacity(size.max(1) as usize);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p as u32
}

#[no_mangle]
pub extern "C" fn game_new(seed: u32, view: u32, smooth: u32) -> u32 {
    Box::into_raw(Box::new(Game::new(seed, view, smooth != 0))) as u32
}

#[no_mangle]
pub unsafe extern "C" fn game_free(g: u32) {
    if g != 0 {
        drop(Box::from_raw(g as *mut Game));
    }
}

#[no_mangle]
pub unsafe extern "C" fn game_set_view(g: u32, view: u32) {
    game_mut(g).view = view.clamp(2, 12) as i32;
}

#[no_mangle]
pub unsafe extern "C" fn game_set_smooth(g: u32, smooth: u32) {
    let game = game_mut(g);
    game.smooth = smooth != 0;
    // AO affects vertices: force remesh of everything currently loaded
    let keys: Vec<(i32, i32, i32)> = game.sections.keys().cloned().collect();
    for key in keys {
        if let Some(rec) = game.sections.get_mut(&key) {
            rec.need_mesh = true;
            if !rec.dirty_queued {
                rec.dirty_queued = true;
                let id = rec.id;
                game.dirty.push(id);
            }
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn game_set_slot(g: u32, slot: u32, block: u32) {
    let game = game_mut(g);
    if (slot as usize) < game.slots.len() {
        game.slots[slot as usize] = (block as u8).min(world::BLOCK_COUNT - 1);
    }
}

#[no_mangle]
pub unsafe extern "C" fn game_tick(g: u32, input_ptr: u32) {
    let inp = Input {
        mx: rf32(input_ptr, 0),
        mz: rf32(input_ptr, 1),
        yaw: rf32(input_ptr, 2),
        pitch: rf32(input_ptr, 3),
        dt: rf32(input_ptr, 4),
        flags: ru32(input_ptr, 5),
    };
    let game = game_mut(g);
    // selected hotbar slot lives in input word 6
    game.current_slot = ru32(input_ptr, 6);
    game.tick(&inp);
}

#[no_mangle]
pub unsafe extern "C" fn game_state(g: u32, out: u32) {
    let game = game_mut(g);
    let p = &game.player;
    wf32(out, 0, p.pos[0]);
    wf32(out, 1, p.pos[1]);
    wf32(out, 2, p.pos[2]);
    wf32(out, 3, p.vel[0]);
    wf32(out, 4, p.vel[1]);
    wf32(out, 5, p.vel[2]);
    let flags = (p.on_ground as u32)
        | ((p.in_water as u32) << 1)
        | ((p.head_water as u32) << 2)
        | ((p.flying as u32) << 3);
    wu32(out, 6, flags);
    wu32(out, 7, game.target.x as u32);
    wu32(out, 8, game.target.y as u32);
    wu32(out, 9, game.target.z as u32);
    wu32(out, 10, game.target.face);
    wu32(out, 11, game.target.block as u32);
    let biome = game.world.biome_at(p.pos[0].floor() as i32, p.pos[2].floor() as i32);
    wu32(out, 12, biome as u32);
    let edits: usize = game.world.edits.values().map(|v| v.len()).sum();
    wu32(out, 13, edits as u32);
    wu32(out, 14, game.world.cols.len() as u32);
    wu32(out, 15, game.sections.len() as u32);
    for i in 16..STATE_WORDS {
        wu32(out, i, 0);
    }
}

#[no_mangle]
pub unsafe extern "C" fn game_update_chunks(g: u32, budget_ms: f32) -> u32 {
    game_mut(g).update_chunks(budget_ms)
}

#[no_mangle]
pub unsafe extern "C" fn game_dirty(g: u32, out: u32, max: u32) -> u32 {
    let game = game_mut(g);
    let n = game.dirty.len().min(max as usize);
    for i in 0..n {
        let id = game.dirty[i];
        wu32(out, i, id);
        if let Some(key) = game.id_map.get(&id).cloned() {
            if let Some(rec) = game.sections.get_mut(&key) {
                rec.dirty_queued = false;
            }
        }
    }
    game.dirty.drain(0..n);
    n as u32
}

#[no_mangle]
pub unsafe extern "C" fn game_unloads(g: u32, out: u32, max: u32) -> u32 {
    let game = game_mut(g);
    let n = game.unloads.len().min(max as usize);
    for i in 0..n {
        wu32(out, i, game.unloads[i]);
    }
    game.unloads.drain(0..n);
    n as u32
}

/// Header (u32 x8): cx, cy, cz, vcount, icount, vert_ptr, idx_ptr, pass.
/// Returns index count (0 when the mesh is empty or id is unknown).
#[no_mangle]
pub unsafe extern "C" fn game_mesh(g: u32, id: u32, pass: u32, out: u32) -> u32 {
    let game = game_mut(g);
    let key = match game.id_map.get(&id) {
        Some(k) => *k,
        None => return 0,
    };
    let rec = match game.sections.get(&key) {
        Some(r) => r,
        None => return 0,
    };
    let m = if pass == 0 { &rec.opaque } else { &rec.water };
    let vcount = (m.verts.len() / 24) as u32;
    let icount = m.idx.len() as u32;
    wu32(out, 0, key.0 as u32);
    wu32(out, 1, key.1 as u32);
    wu32(out, 2, key.2 as u32);
    wu32(out, 3, vcount);
    wu32(out, 4, icount);
    wu32(out, 5, m.verts.as_ptr() as u32);
    wu32(out, 6, m.idx.as_ptr() as u32);
    wu32(out, 7, pass);
    icount
}

/// Re-queue every loaded section so the renderer can re-fetch meshes
/// (used after a WebGL context loss).
#[no_mangle]
pub unsafe extern "C" fn game_invalidate(g: u32) {
    let game = game_mut(g);
    let keys: Vec<(i32, i32, i32)> = game.sections.keys().cloned().collect();
    for key in keys {
        if let Some(rec) = game.sections.get_mut(&key) {
            if rec.built && !rec.dirty_queued {
                rec.dirty_queued = true;
                let id = rec.id;
                game.dirty.push(id);
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn game_save_size(g: u32) -> u32 {
    let game = unsafe { game_mut(g) };
    let edits: usize = game.world.edits.values().map(|v| v.len()).sum();
    (44 + edits * 16) as u32
}

#[no_mangle]
pub unsafe extern "C" fn game_save(g: u32, out: u32) -> u32 {
    let game = game_mut(g);
    let mut p = out as *mut u8;
    macro_rules! put_u32 {
        ($v:expr) => {{
            *(p as *mut u32) = $v;
            p = p.add(4);
        }};
    }
    macro_rules! put_f32 {
        ($v:expr) => {{
            *(p as *mut f32) = $v;
            p = p.add(4);
        }};
    }
    *(p as *mut u32) = u32::from_le_bytes(*b"RCWS");
    p = p.add(4);
    put_u32!(1u32); // version
    put_u32!(game.world.seed);
    put_f32!(game.player.pos[0]);
    put_f32!(game.player.pos[1]);
    put_f32!(game.player.pos[2]);
    put_f32!(game.player.vel[0]);
    put_f32!(game.player.vel[1]);
    put_f32!(game.player.vel[2]);
    put_u32!(game.player.flying as u32);
    let edits: usize = game.world.edits.values().map(|v| v.len()).sum();
    put_u32!(edits as u32);
    for (key, list) in game.world.edits.iter() {
        for (packed, id) in list.iter() {
            let lx = (packed % 16u16) as i32;
            let lz = ((packed / 16u16) % 16u16) as i32;
            let y = (packed / 256u16) as i32;
            let x = key.0 * 16 + lx;
            let z = key.1 * 16 + lz;
            put_u32!(x as u32);
            put_u32!(y as u32);
            put_u32!(z as u32);
            put_u32!(*id as u32);
        }
    }
    (p as u32) - out
}

#[no_mangle]
pub unsafe extern "C" fn game_load(g: u32, ptr: u32, len: u32) -> u32 {
    if len < 44 {
        return 0;
    }
    let p = ptr as *const u8;
    let magic = *(p as *const u32);
    if magic != u32::from_le_bytes(*b"RCWS") {
        return 0;
    }
    let version = *((p.add(4)) as *const u32);
    if version != 1 {
        return 0;
    }
    let seed = *((p.add(8)) as *const u32);
    let pos = [
        *((p.add(12)) as *const f32),
        *((p.add(16)) as *const f32),
        *((p.add(20)) as *const f32),
    ];
    let vel = [
        *((p.add(24)) as *const f32),
        *((p.add(28)) as *const f32),
        *((p.add(32)) as *const f32),
    ];
    let flying = *((p.add(36)) as *const u32) != 0;
    let n = *((p.add(40)) as *const u32) as usize;
    if len < (44 + n * 16) as u32 {
        return 0;
    }

    let game = game_mut(g);
    // wipe runtime world & GPU-tracked sections
    let dead: Vec<u32> = game.sections.values().map(|r| r.id).collect();
    game.unloads.extend(dead);
    game.sections.clear();
    game.id_map.clear();
    game.dirty.clear();
    game.world = World::new(seed);
    for i in 0..n {
        let q = p.add(44 + i * 16);
        let x = *(q as *const i32);
        let y = *((q.add(4)) as *const i32);
        let z = *((q.add(8)) as *const i32);
        let id = *((q.add(12)) as *const u32) as u8;
        game.world.set(x, y, z, id);
    }
    game.player = Player::new(pos[0], pos[1], pos[2]);
    game.player.vel = vel;
    game.player.flying = flying;
    game.target = Hit::none();
    1
}

#[no_mangle]
pub unsafe extern "C" fn game_stats(g: u32, out: u32) {
    let game = game_mut(g);
    wu32(out, 0, game.world.cols.len() as u32);
    wu32(out, 1, game.sections.len() as u32);
    wu32(out, 2, game.dirty.len() as u32);
    wu32(out, 3, game.unloads.len() as u32);
    let edits: usize = game.world.edits.values().map(|v| v.len()).sum();
    wu32(out, 4, edits as u32);
    wu32(out, 5, game.next_id);
    for i in 6..16 {
        wu32(out, i, 0);
    }
}
