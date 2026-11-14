//! Deterministic seeded gradient noise (Perlin) + fBm, no external crates.

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x9E37_79B9_7F4A_7C15)
    }
    #[inline]
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
}

/// splitmix-style 64-bit mix of a coordinate triple -> stable across runs.
#[inline]
pub fn hash3(seed: u32, x: i32, y: i32, z: i32) -> u64 {
    let mut h = (seed as u64)
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(x as u64)
        .wrapping_mul(0xBF58_476D_1CE4_E5B9)
        .wrapping_add(y as u64)
        .wrapping_mul(0x94D0_49BB_1331_11EB)
        .wrapping_add(z as u64);
    h = (h ^ (h >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    h = (h ^ (h >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    h ^ (h >> 31)
}

#[inline]
pub fn hash2(seed: u32, x: i32, z: i32) -> u64 {
    hash3(seed, x, 0, z)
}

pub struct Noise {
    p: [u8; 512],
}

#[inline]
fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

impl Noise {
    pub fn new(seed: u32) -> Noise {
        let mut p = [0u8; 256];
        for (i, v) in p.iter_mut().enumerate() {
            *v = i as u8;
        }
        let mut rng = Rng::new(seed as u64);
        for i in (1..256usize).rev() {
            let j = (rng.next() % (i as u64 + 1)) as usize;
            p.swap(i, j);
        }
        let mut pp = [0u8; 512];
        for i in 0..512 {
            pp[i] = p[i & 255];
        }
        Noise { p: pp }
    }

    #[inline]
    fn grad2(h: u8, x: f32, y: f32) -> f32 {
        // 8 directions on the unit circle-ish grid
        match h & 7 {
            0 => x + y,
            1 => -x + y,
            2 => x - y,
            3 => -x - y,
            4 => x,
            5 => -x,
            6 => y,
            _ => -y,
        }
    }

    #[inline]
    fn grad3(h: u8, x: f32, y: f32, z: f32) -> f32 {
        match h % 12 {
            0 => x + y,
            1 => -x + y,
            2 => x - y,
            3 => -x - y,
            4 => x + z,
            5 => -x + z,
            6 => x - z,
            7 => -x - z,
            8 => y + z,
            9 => -y + z,
            10 => y - z,
            _ => -y - z,
        }
    }

    pub fn perlin2(&self, x: f32, y: f32) -> f32 {
        let xi = x.floor();
        let yi = y.floor();
        let xf = x - xi;
        let yf = y - yi;
        let xi = xi as i32 & 255;
        let yi = yi as i32 & 255;
        let u = fade(xf);
        let v = fade(yf);
        let aa = self.p[(self.p[xi as usize] as usize + yi as usize) & 511];
        let ab = self.p[(self.p[xi as usize] as usize + yi as usize + 1) & 511];
        let ba = self.p[(self.p[(xi as usize + 1) & 511] as usize + yi as usize) & 511];
        let bb = self.p[(self.p[(xi as usize + 1) & 511] as usize + yi as usize + 1) & 511];
        let x1 = lerp(
            Self::grad2(aa, xf, yf),
            Self::grad2(ba, xf - 1.0, yf),
            u,
        );
        let x2 = lerp(
            Self::grad2(ab, xf, yf - 1.0),
            Self::grad2(bb, xf - 1.0, yf - 1.0),
            u,
        );
        lerp(x1, x2, v)
    }

    pub fn perlin3(&self, x: f32, y: f32, z: f32) -> f32 {
        let xi = x.floor();
        let yi = y.floor();
        let zi = z.floor();
        let xf = x - xi;
        let yf = y - yi;
        let zf = z - zi;
        let xi = (xi as i32 & 255) as usize;
        let yi = (yi as i32 & 255) as usize;
        let zi = (zi as i32 & 255) as usize;
        let u = fade(xf);
        let v = fade(yf);
        let w = fade(zf);
        let a = self.p[xi] as usize + yi;
        let aa = self.p[a & 511] as usize + zi;
        let ab = self.p[(a + 1) & 511] as usize + zi;
        let b = self.p[(xi + 1) & 511] as usize + yi;
        let ba = self.p[b & 511] as usize + zi;
        let bb = self.p[(b + 1) & 511] as usize + zi;

        let x1 = lerp(
            Self::grad3(self.p[aa & 511], xf, yf, zf),
            Self::grad3(self.p[ba & 511], xf - 1.0, yf, zf),
            u,
        );
        let x2 = lerp(
            Self::grad3(self.p[ab & 511], xf, yf - 1.0, zf),
            Self::grad3(self.p[bb & 511], xf - 1.0, yf - 1.0, zf),
            u,
        );
        let y1 = lerp(x1, x2, v);
        let x3 = lerp(
            Self::grad3(self.p[(aa + 1) & 511], xf, yf, zf - 1.0),
            Self::grad3(self.p[(ba + 1) & 511], xf - 1.0, yf, zf - 1.0),
            u,
        );
        let x4 = lerp(
            Self::grad3(self.p[(ab + 1) & 511], xf, yf - 1.0, zf - 1.0),
            Self::grad3(self.p[(bb + 1) & 511], xf - 1.0, yf - 1.0, zf - 1.0),
            u,
        );
        let y2 = lerp(x3, x4, v);
        lerp(y1, y2, w)
    }

    /// fractal Brownian motion, roughly -1..1
    pub fn fbm2(&self, x: f32, y: f32, octaves: u32) -> f32 {
        let mut amp = 1.0f32;
        let mut freq = 1.0f32;
        let mut sum = 0.0f32;
        let mut norm = 0.0f32;
        for _ in 0..octaves {
            sum += self.perlin2(x * freq, y * freq) * amp;
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        sum / norm.max(0.0001)
    }

    pub fn fbm3(&self, x: f32, y: f32, z: f32, octaves: u32) -> f32 {
        let mut amp = 1.0f32;
        let mut freq = 1.0f32;
        let mut sum = 0.0f32;
        let mut norm = 0.0f32;
        for _ in 0..octaves {
            sum += self.perlin3(x * freq, y * freq, z * freq) * amp;
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        sum / norm.max(0.0001)
    }
}
