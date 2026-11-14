//! Player physics: AABB collision, gravity, flying, swimming, block raycast.

use crate::world::{is_solid, World, WATER, AIR, is_cross};

pub const HALF: f32 = 0.3;
pub const HEIGHT: f32 = 1.8;
pub const EYE: f32 = 1.62;

// input flag bits
pub const F_JUMP: u32 = 1 << 0;
pub const F_SNEAK: u32 = 1 << 1;
pub const F_SPRINT: u32 = 1 << 2;
pub const F_FLY_TOGGLE: u32 = 1 << 3;
pub const F_BREAK_HELD: u32 = 1 << 4;
pub const F_BREAK_PRESS: u32 = 1 << 5;
pub const F_PLACE_PRESS: u32 = 1 << 6;
pub const F_UP: u32 = 1 << 7;
pub const F_DOWN: u32 = 1 << 8;

pub struct Input {
    pub mx: f32,
    pub mz: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub dt: f32,
    pub flags: u32,
}

pub struct Player {
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub on_ground: bool,
    pub flying: bool,
    pub in_water: bool,
    pub head_water: bool,
}

#[derive(Clone, Copy)]
pub struct Hit {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub face: u32, // 0 +Y, 1 -Y, 2 +X, 3 -X, 4 +Z, 5 -Z
    pub block: u8,
}

impl Hit {
    pub fn none() -> Hit {
        Hit { x: 0, y: 0, z: 0, face: 255, block: 0 }
    }
    pub fn place_pos(&self) -> (i32, i32, i32) {
        match self.face {
            0 => (self.x, self.y + 1, self.z),
            1 => (self.x, self.y - 1, self.z),
            2 => (self.x + 1, self.y, self.z),
            3 => (self.x - 1, self.y, self.z),
            4 => (self.x, self.y, self.z + 1),
            _ => (self.x, self.y, self.z - 1),
        }
    }
}

impl Player {
    pub fn new(x: f32, y: f32, z: f32) -> Player {
        Player {
            pos: [x, y, z],
            vel: [0.0, 0.0, 0.0],
            on_ground: false,
            flying: false,
            in_water: false,
            head_water: false,
        }
    }

    pub fn look_dir(yaw: f32, pitch: f32) -> [f32; 3] {
        let (sy, cy) = yaw.sin_cos();
        let (sp, cp) = pitch.sin_cos();
        [-cp * sy, sp, -cp * cy]
    }

    fn move_axis(&mut self, world: &mut World, axis: usize, d: f32) {
        if d == 0.0 {
            return;
        }
        self.pos[axis] += d;
        let min = [self.pos[0] - HALF, self.pos[1], self.pos[2] - HALF];
        let max = [self.pos[0] + HALF, self.pos[1] + HEIGHT, self.pos[2] + HALF];
        let x0 = min[0].floor() as i32;
        let x1 = max[0].floor() as i32;
        let y0 = min[1].floor() as i32;
        let y1 = max[1].floor() as i32;
        let z0 = min[2].floor() as i32;
        let z1 = max[2].floor() as i32;
        for y in y0..=y1 {
            for z in z0..=z1 {
                for x in x0..=x1 {
                    if is_solid(world.get(x, y, z)) {
                        match axis {
                            0 => {
                                if d > 0.0 {
                                    self.pos[0] = x as f32 - HALF - 0.001;
                                } else {
                                    self.pos[0] = x as f32 + 1.0 + HALF + 0.001;
                                }
                                self.vel[0] = 0.0;
                            }
                            1 => {
                                if d > 0.0 {
                                    self.pos[1] = y as f32 - HEIGHT - 0.001;
                                    self.vel[1] = 0.0;
                                } else {
                                    self.pos[1] = y as f32 + 1.0 + 0.001;
                                    self.vel[1] = 0.0;
                                    self.on_ground = true;
                                }
                            }
                            _ => {
                                if d > 0.0 {
                                    self.pos[2] = z as f32 - HALF - 0.001;
                                } else {
                                    self.pos[2] = z as f32 + 1.0 + HALF + 0.001;
                                }
                                self.vel[2] = 0.0;
                            }
                        }
                        return;
                    }
                }
            }
        }
    }

    pub fn intersects_block(&self, bx: i32, by: i32, bz: i32) -> bool {
        let min = [self.pos[0] - HALF, self.pos[1], self.pos[2] - HALF];
        let max = [self.pos[0] + HALF, self.pos[1] + HEIGHT, self.pos[2] + HALF];
        (bx as f32) < max[0]
            && (bx as f32 + 1.0) > min[0]
            && (by as f32) < max[1]
            && (by as f32 + 1.0) > min[1]
            && (bz as f32) < max[2]
            && (bz as f32 + 1.0) > min[2]
    }

    pub fn step(&mut self, world: &mut World, inp: &Input) {
        let mut dt = inp.dt;
        if dt < 0.0 {
            dt = 0.0;
        }
        if dt > 0.1 {
            dt = 0.1;
        }

        // water state
        let fx = self.pos[0].floor() as i32;
        let fy = self.pos[1].floor() as i32;
        let fz = self.pos[2].floor() as i32;
        self.in_water = world.get(fx, fy + 1, fz) == WATER
            || world.get(fx, (self.pos[1] + 0.4).floor() as i32, fz) == WATER;
        self.head_water = world.get(fx, (self.pos[1] + EYE).floor() as i32, fz) == WATER;

        if inp.flags & F_FLY_TOGGLE != 0 {
            self.flying = !self.flying;
            if self.flying {
                self.vel[1] = 0.0;
            }
        }

        // desired horizontal direction from input, relative to yaw
        let (sy, cy) = inp.yaw.sin_cos();
        let fwd = [-sy, 0.0, -cy];
        let right = [cy, 0.0, -sy];
        let mut dx = fwd[0] * inp.mz + right[0] * inp.mx;
        let mut dz = fwd[2] * inp.mz + right[2] * inp.mx;
        let len = (dx * dx + dz * dz).sqrt();
        if len > 1.0 {
            dx /= len;
            dz /= len;
        }

        let sneak = inp.flags & F_SNEAK != 0;
        let sprint = inp.flags & F_SPRINT != 0 && !sneak;

        let mut speed = if self.flying {
            if sprint { 21.0 } else { 10.5 }
        } else if self.in_water {
            3.2
        } else if sneak {
            1.6
        } else if sprint {
            6.2
        } else {
            4.4
        };
        if self.flying && sneak {
            speed = 3.5;
        }

        let accel = if self.flying {
            9.0
        } else if self.on_ground {
            11.0
        } else if self.in_water {
            5.0
        } else {
            3.2
        };
        let k = (dt * accel).min(1.0);
        self.vel[0] += (dx * speed - self.vel[0]) * k;
        self.vel[2] += (dz * speed - self.vel[2]) * k;

        if self.flying {
            let up = if inp.flags & F_JUMP != 0 || inp.flags & F_UP != 0 {
                1.0
            } else {
                0.0
            };
            let down = if sneak || inp.flags & F_DOWN != 0 {
                1.0
            } else {
                0.0
            };
            let target_vy = (up - down) * if sprint { 13.0 } else { 7.5 };
            self.vel[1] += (target_vy - self.vel[1]) * (dt * 9.0).min(1.0);
        } else if self.in_water {
            self.vel[1] -= 7.0 * dt;
            if self.vel[1] < -3.2 {
                self.vel[1] = -3.2;
            }
            if inp.flags & F_JUMP != 0 {
                self.vel[1] = (self.vel[1] + 26.0 * dt).min(4.4);
            }
        } else {
            self.vel[1] -= 28.0 * dt;
            if self.vel[1] < -55.0 {
                self.vel[1] = -55.0;
            }
            if inp.flags & F_JUMP != 0 && self.on_ground {
                self.vel[1] = 9.3;
                self.on_ground = false;
            }
        }

        // integrate with collision, axis by axis
        self.on_ground = false;
        let vx = self.vel[0] * dt;
        let vy = self.vel[1] * dt;
        let vz = self.vel[2] * dt;
        self.move_axis(world, 1, vy);
        self.move_axis(world, 0, vx);
        self.move_axis(world, 2, vz);

        // soft world floor
        if self.pos[1] < -20.0 {
            self.pos[1] = -20.0;
            self.vel[1] = 0.0;
        }
    }
}

/// Amanatides & Woo voxel traversal. Skips water & plants.
pub fn raycast(
    world: &World,
    ox: f32,
    oy: f32,
    oz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    max_dist: f32,
) -> Hit {
    let mut x = ox.floor() as i32;
    let mut y = oy.floor() as i32;
    let mut z = oz.floor() as i32;

    let step_x = if dx > 0.0 { 1 } else { -1 };
    let step_y = if dy > 0.0 { 1 } else { -1 };
    let step_z = if dz > 0.0 { 1 } else { -1 };

    let t_dx = if dx.abs() < 1e-8 { 1e30 } else { (1.0 / dx).abs() };
    let t_dy = if dy.abs() < 1e-8 { 1e30 } else { (1.0 / dy).abs() };
    let t_dz = if dz.abs() < 1e-8 { 1e30 } else { (1.0 / dz).abs() };

    let mut t_mx = if dx.abs() < 1e-8 {
        1e30
    } else if dx > 0.0 {
        (x as f32 + 1.0 - ox) / dx
    } else {
        (ox - x as f32) / -dx
    };
    let mut t_my = if dy.abs() < 1e-8 {
        1e30
    } else if dy > 0.0 {
        (y as f32 + 1.0 - oy) / dy
    } else {
        (oy - y as f32) / -dy
    };
    let mut t_mz = if dz.abs() < 1e-8 {
        1e30
    } else if dz > 0.0 {
        (z as f32 + 1.0 - oz) / dz
    } else {
        (oz - z as f32) / -dz
    };

    let mut face = 255u32;
    let mut t = 0.0f32;
    loop {
        if t > max_dist {
            return Hit::none();
        }
        let b = world.get(x, y, z);
        if b != AIR && b != WATER && !is_cross(b) {
            return Hit {
                x,
                y,
                z,
                face,
                block: b,
            };
        }
        if b != AIR && is_cross(b) {
            return Hit {
                x,
                y,
                z,
                face,
                block: b,
            };
        }
        if t_mx < t_my && t_mx < t_mz {
            x += step_x;
            t = t_mx;
            t_mx += t_dx;
            face = if step_x > 0 { 3 } else { 2 };
        } else if t_my < t_mz {
            y += step_y;
            t = t_my;
            t_my += t_dy;
            face = if step_y > 0 { 1 } else { 0 };
        } else {
            z += step_z;
            t = t_mz;
            t_mz += t_dz;
            face = if step_z > 0 { 5 } else { 4 };
        }
    }
}
