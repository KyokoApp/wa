# RustCraft Web — Voxel Sandbox dengan Engine Rust (WebAssembly)

Game voxel sandbox orisinal bergaya Minecraft yang berjalan **penuh di browser**:
engine simulasi dunia ditulis dalam **Rust** dan dikompilasi ke **WebAssembly**
(wasm32-unknown-unknown), dirender dengan **WebGL2** + shader GLSL ala shader pack
Java (waving leaves/water, bloom, awan prosedural, siklus siang–malam, water
specular, ambient occlusion).

> ⚠️ Catatan: mengekstrak / menyalin Minecraft Bedrock (APK) atau Minecraft Java
> ke web tidak mungkin dilakukan (kode milik Mojang/Microsoft, dilindungi hak
> cipta). Proyek ini adalah implementasi orisinal dari nol dengan cita rasa dan
> fitur yang serupa — bukan hasil port/ekstraksi Minecraft. Tidak berafiliasi
> dengan Mojang/Microsoft.

## Fitur

**Engine (Rust → WASM, ~87 KB):**
- Terrain prosedural tak terbatas (infinite): 6 bioma — Ocean, Beach, Plains,
  Forest, Desert, Mountains — dengan gua, danau/laut, pohon, rumput & bunga
- Bijih: coal, iron, diamond, gravel
- Chunk streaming bertahap berdasarkan jarak render + unload otomatis
- Meshing per section 16³ dengan **face culling** dan **per-vertex ambient
  occlusion** (anisotropy-aware triangulation)
- Fisika pemain: AABB collision, gravitasi, lompat, sprint, jongkok, berenang,
  **mode terbang** (creative)
- Raycast voxel (DDA) untuk hancurkan/pasang blok, proteksi pasang di badan pemain
- 22 jenis blok + sistem edit dunia (edits bertahan walau chunk di-unload)
- Save/load dunia (format biner) → localStorage

**Renderer (WebGL2 + GLSL):**
- Langit prosedural: gradasi warna dinamis, matahari + glow, bulan, bintang
  berkelip, **awan fbm bergerak** yang terkena cahaya senja
- Shader pack: **daun & tanaman bergoyang**, **air berombak** dengan specular
  matahari + fresnel, fog jarak, **bloom** (bright-pass + gaussian blur),
  ACES tonemapping, grading siang/malam, vignette
- Smooth lighting (AO) yang bisa dimatikan
- Frustum culling per section, pass transparan terurut back-to-front
- 3 level kualitas: Off (performa maksimal) / Medium / Tinggi
- Ikon blok isometric & tekstur pixel-art **100% prosedural** (tanpa asset eksternal)

**Kontrol lengkap (Java + ala Bedrock):**
- Desktop: WASD, mouse look (pointer lock), klik kiri/kanan, 1–9/scroll, E
  inventaris, F3 debug, Esc pause, **Space 2× / F = terbang**
- Sentuh (HP/tablet): joystick virtual kiri, drag kanan untuk lihat, **tap =
  pasang blok, tahan = hancurkan**, tombol lompat/terbang/sprint/sneak, tombol
  hancur & pasang eksplisit

## Menjalankan

```bash
node webcraft/server.mjs        # atau: python3 -m http.server -d webcraft/web 8080
# buka http://localhost:8080
```

Server statis apa pun bisa dipakai, asalkan `rustcraft.wasm` tersaji (MIME
`application/wasm` tidak wajib — loader memakai ArrayBuffer).

## Membangun engine (Rust → WASM)

```bash
cd webcraft
./build.sh
```

`build.sh` memakai `rustc` dari PATH bila ada (pengguna rustup:
`rustup target add wasm32-unknown-unknown`), atau mem-bootstrap toolchain Rust
lengkap **dari npm** (`@toolchain-bin/rustc` + `rust-std-wasm32-unknown-unknown`)
— bekerja di lingkungan air-gapped yang hanya membuka registry npm.

Alternatif dengan cargo (dari folder `engine/`):

```bash
cargo build --release --target wasm32-unknown-unknown
```

Tidak ada dependency crates.io sama sekali — hanya std Rust. Import tunggal ke
JS: `env.host_now()` (jam monotonic untuk budget streaming chunk).

## Arsitektur ABI

Rust memperlihatkan C ABI murni (tanpa wasm-bindgen), lihat
`engine/src/lib.rs` & kontraknya di `web/js/engine.js`:

| Fungsi | Fungsi |
|---|---|
| `game_new/free` | buang & buat dunia |
| `game_tick(input_ptr)` | fisika + aksi (input 32 byte: move, yaw/pitch, dt, flags, slot) |
| `game_state(out_ptr)` | posisi/vel/flag pemain + target raycast + biome |
| `game_update_chunks(budget_ms)` | streaming generate + meshing terbatas waktu |
| `game_dirty/game_unloads` | antrean upload/hapus mesh ke GPU |
| `game_mesh(id, pass, out)` | pointer vertex (24 B/vert: pos, uv, shade/AO/emissive/wave) + index u32 |
| `game_save/game_load` | serialisasi biner (seed, pemain, edits) |

Struktur proyek:

```
webcraft/
├── build.sh              # build Rust → web/rustcraft.wasm (auto-bootstrap toolchain)
├── server.mjs            # static server untuk preview lokal
├── engine/src/           # engine Rust (no crates): noise, world, mesh, physics, lib
├── web/
│   ├── index.html        # menu, HUD, inventory, touch controls (UI bahasa Indonesia)
│   ├── rustcraft.wasm    # hasil build (siap pakai)
│   └── js/               # math, blocks, textures (atlas prosedural), shaders (GLSL),
│                         # renderer (WebGL2), input, ui, main
└── test/
    ├── smoke.mjs         # 19 test engine headless di Node
    ├── wrapper.mjs       # 13 test integrasi JS wrapper ↔ wasm
    ├── syntax.mjs        # parse-check semua modul JS
    └── shaders.mjs       # validasi GLSL via glslangValidator
```

## Menjalankan test

```bash
node webcraft/test/smoke.mjs      # engine Rust headless
node webcraft/test/wrapper.mjs    # integrasi wrapper JS
node --experimental-vm-modules webcraft/test/syntax.mjs
node webcraft/test/shaders.mjs    # butuh glslangValidator (opsional)
```

## Performa

- Mesin: Rust `-O3 -C lto=fat -C panic=abort -C strip` → wasm 87 KB, meshing +
  fisika + worldgen berjalan penuh di WASM (near-native)
- Budget frame adaptif (10–16 ms) untuk generate/mesh agar FPS tetap stabil
- AO & face-culling memangkas geometri; frustum culling per section 16³;
  kualitas shader bisa dimatikan untuk perangkat lemah / mobile

MIT License — silakan dikembangkan.
