---
name: ui-from-image
description: Ekstrak design system (palet warna, tipografi, layout, spacing, border-radius, efek visual/glassmorphism) dari gambar UI referensi dan terapkan secara presisi ke kode frontend proyek.
---

# UI from Image — Design System Extractor & Implementer

Panduan komprehensif untuk mengekstrak sistem desain lengkap dari gambar referensi (mockup, screenshot Figma/Dribbble/aplikasi nyata) dan menerapkannya ke dalam file HTML/CSS/JS di proyek ini secara rapi, konsisten, dan bebas dari tampilan kaku (*anti-slop*).

---

## 🎯 Tujuan Utama

Ketika pengguna melampirkan gambar referensi antarmuka (UI):
1. **Dekomposisi sistematis**: Jangan hanya menebak-nebak warna secara acak; ekstrak token desain terstruktur (Warna & Gradient, Tipografi, Spacing, Radius, Shadow & Border, serta Hierarchy).
2. **Standarisasi ke Design Tokens (CSS Variables)**: Konversikan hasil ekstraksi ke variabel CSS kustom (`:root` / `[data-theme="dark"]`).
3. **Penerapan Terarah**: Terapkan komponen tersebut ke halaman terkait (misal `harga.html`, `pos.html`, atau halaman dashboard baru) tanpa merusak fungsionalitas dan logika bisnis yang sudah ada.
4. **Fidelity & Ergonomi Visual**: Terapkan detail mikro seperti sudut lengkung halus (*squircle / large border-radius*), pill tabs, glassmorphism lembut, badge status kontras, dan font angka tabular.

---

## 🔍 Tahap 1: Analisis & Dekomposisi Gambar

Lakukan inspeksi teliti pada gambar referensi menggunakan 6 dimensi desain berikut:

### 1. Palet Warna & Permukaan (Color & Surfaces)
- **Background Utama (Canvas)**: Identifikasi warna dasar (misal dark deep slate: `#0A0D14`, `#0D111A`, atau navy-black).
- **Surface / Card Backgrounds**: 
  - Card tingkat 1 (kontainer utama): biasanya sedikit lebih terang (`#141923` atau `rgba(255, 255, 255, 0.05)`).
  - Card tingkat 2 (nested / item list): kontras bertingkat (`#1A2230`, `#20293A`).
- **Gradients & Hero Cards**:
  - Catat arah sudut (misal `135deg`) dan perpaduan warna neon/pastel (contoh: Lime-Mint `linear-gradient(135deg, #a8ff78 0%, #78ffd6 100%)`, Sunset Orange `linear-gradient(135deg, #ff9a8b 0%, #ff6a88 100%)`, Lavender Violet `linear-gradient(135deg, #c471ed 0%, #f64f59 100%)`).
- **Aksen & Semantic Status**:
  - Sukses / Pertumbuhan: Neon green / mint (`#22c55e`, `#4ade80`, `#a3e635`).
  - Penurunan / Peringatan / Pengeluaran: Coral / soft red (`#f87171`, `#fb7185`).
  - Aksen sekunder: Vivid purple (`#818cf8`, `#a78bfa`), Cyan (`#38bdf8`), Gold (`#facc15`).
- **Teks**:
  - Primary text: Kontras tinggi (`#ffffff` atau `#f8fafc`).
  - Secondary / Muted: `#94a3b8`, `#64748b` (jangan terlalu redup agar tetap terbaca).

### 2. Border, Depth & Glassmorphism
- **Subtle Borders**: Kartu dark mode modern jarang memakai outline tebal; gunakan border 1px semi-transparan:
  ```css
  border: 1px solid rgba(255, 255, 255, 0.07);
  ```
- **Glassmorphism / Frosting**:
  ```css
  background: rgba(22, 28, 38, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  ```
- **Inner Glow / Highlight**: Garis cahaya halus di tepi atas card untuk kesan 3D tactile:
  ```css
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.12), 0 12px 32px rgba(0, 0, 0, 0.35);
  ```

### 3. Skala Radius (Border-Radius Hierarchy)
Amati seberapa melengkung elemen pada gambar referensi:
- **Pill / Capsular (`9999px`)**: Tombol aksi utama, tab aktif navigasi atas, filter chips, badge status.
- **Card Utama (`24px` - `32px`)**: Kontainer luar, Hero Balance card, modal, sidebar drawer.
- **Item / Nested Card (`14px` - `20px`)**: Transaksi list item, kartu mini info, input field.
- **Micro Radius (`8px` - `10px`)**: Tooltip, dropdown kecil, icon wrapper.

### 4. Tipografi & Tabular Numbers
- **Font Stack**: Modern geometric sans-serif (Inter, Plus Jakarta Sans, Outfit, System UI) dipadukan dengan Geist Mono / Space Grotesk untuk angka & finansial:
  ```css
  font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  ```
- **Angka Finansial**: Selalu aktifkan fitur tabular numerik agar angka tidak bergeser saat nilai berubah:
  ```css
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
  ```
- **Hierarki Skala Ukuran**:
  - Large Hero Metric: `32px` - `44px`, font-weight `700` atau `800`.
  - Section Title / H2: `20px` - `24px`, font-weight `600`.
  - Body / Label: `13px` - `15px`, font-weight `500`.
  - Subtitle / Meta / Date: `11px` - `12px`, letter-spacing `0.02em`.

### 5. Layout, Spacing & Grid System
- **Grid Layout**: Dashboard modular dengan 2-3 kolom responsif (contoh: Area Utama 65-70% lebar + Sidebar Finansial/Cards 30-35% lebar).
- **Spacing Scale (Kelipatan 4px / 8px)**:
  - Gap antar section: `24px` - `32px`
  - Gap dalam card: `16px` - `20px`
  - Padding card: `20px` - `28px` (jangan pelit padding agar elemen bernapas lega)

---

## 🛠️ Tahap 2: Menghasilkan Design Tokens (CSS Variables)

Definisikan variabel desain hasil ekstraksi pada berkas CSS utama (misal `style.css` atau file CSS komponen terkait):

```css
:root {
  /* Canvas & Surfaces */
  --bg-app: #0b0f17;
  --bg-card: #151a24;
  --bg-card-subtle: #1a212e;
  --bg-card-hover: #222b3c;
  
  /* Borders & Overlays */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-focus: rgba(168, 255, 120, 0.4);
  --glass-bg: rgba(21, 26, 36, 0.72);
  --glass-blur: blur(16px);

  /* Gradients */
  --grad-hero-lime: linear-gradient(135deg, #a8ff78 0%, #78ffd6 100%);
  --grad-card-orange: linear-gradient(135deg, #ff9a8b 0%, #ff6a88 100%);
  --grad-card-purple: linear-gradient(135deg, #c471ed 0%, #a18cd1 100%);

  /* Accents & Status */
  --accent-lime: #a8ff78;
  --accent-mint: #78ffd6;
  --accent-purple: #c471ed;
  --accent-blue: #38bdf8;
  --status-pos: #4ade80;
  --status-pos-bg: rgba(74, 222, 128, 0.15);
  --status-neg: #fb7185;
  --status-neg-bg: rgba(251, 113, 133, 0.15);

  /* Typography */
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --text-dark-on-accent: #0b1509;

  /* Radius Scale */
  --radius-xs: 8px;
  --radius-sm: 12px;
  --radius-md: 18px;
  --radius-lg: 26px;
  --radius-pill: 9999px;

  /* Shadows */
  --shadow-card: 0 10px 30px rgba(0, 0, 0, 0.4);
  --shadow-glow-lime: 0 8px 24px rgba(120, 255, 214, 0.25);
}
```

---

## 🧩 Tahap 3: Konstruksi Pola Komponen Utama

Terapkan pola komponen spesifik yang terdapat pada gambar referensi:

### 1. Header Navigasi Pill Floating
```html
<nav class="pill-nav">
  <button class="pill-tab active">Dashboard</button>
  <button class="pill-tab">Statistik</button>
  <button class="pill-tab">Transaksi</button>
  <button class="pill-tab">Kasir</button>
</nav>
```
```css
.pill-nav {
  display: inline-flex;
  gap: 6px;
  padding: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
}
.pill-tab {
  padding: 8px 18px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
}
.pill-tab.active {
  background: #ffffff;
  color: #0b0f17;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
```

### 2. Hero Balance Card (Neon Gradient dengan Dark Text)
```html
<div class="hero-balance-card">
  <div class="hero-label">Total Saldo Toko</div>
  <div class="hero-amount">Rp 120.456.500</div>
  <div class="hero-meta">+Rp 2.456.000 dibanding bulan lalu</div>
  <div class="hero-actions">
    <button class="hero-btn dark">Kirim / Transfer</button>
    <button class="hero-btn light">Top Up Modal</button>
  </div>
</div>
```
```css
.hero-balance-card {
  background: var(--grad-hero-lime);
  color: var(--text-dark-on-accent);
  border-radius: var(--radius-lg);
  padding: 28px;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-glow-lime);
}
.hero-amount {
  font-size: 36px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  margin: 10px 0 6px;
  letter-spacing: -0.02em;
}
.hero-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.hero-btn {
  padding: 10px 20px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 600;
  border: none;
  cursor: pointer;
}
.hero-btn.dark {
  background: #000000;
  color: #ffffff;
}
.hero-btn.light {
  background: rgba(255, 255, 255, 0.85);
  color: #0b0f17;
}
```

### 3. Glassmorphic Stacked Cards / List
```css
.stacked-card {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 18px;
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.stacked-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255, 255, 255, 0.16);
}
```

### 4. Donut Chart / Progress Minimalist
Untuk representasi visual seperti "Expense Split" atau alokasi kategori:
- Gunakan SVG melingkar dengan `stroke-dasharray` atau `conic-gradient` murni via CSS:
```css
.donut-preview {
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: conic-gradient(
    #facc15 0% 30%,
    #fb7185 30% 40%,
    #4ade80 40% 50%,
    #38bdf8 50% 65%,
    #c471ed 65% 85%,
    #f97316 85% 100%
  );
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.donut-preview::after {
  content: '';
  width: 84px;
  height: 84px;
  border-radius: 50%;
  background: var(--bg-card);
}
```

---

## 📋 Tahap 4: Langkah Pelaksanaan (Checklist Penerapan)

Saat menerapkan ke proyek ini:
1. **Audit Halaman Sasaran**: Tentukan file mana yang akan dirombak (misal `harga.html` + `harga.css`, `pos.html` + `pos.css`, atau dashboard ringkasan).
2. **Preserve Logic**: Pastikan semua selector ID, attribute `data-*`, event handler JS, dan struktur data form tidak rusak atau terhapus.
3. **Inject CSS Tokens**: Masukkan token warna, font, radius, dan shadow di bagian atas stylesheet.
4. **Perbarui Struktur HTML**: Sesuaikan class dan hierarki DOM agar menyerupai card & pill dari gambar referensi.
5. **Harmonisasi Dark/Light**:
   - Jika proyek memiliki tombol saklar tema (`toggleTheme`), pastikan tema light memiliki padanan kontras yang pas (misal canvas `#f8fafc`, card `#ffffff`, teks `#0f172a`).
6. **Verifikasi Visual & Responsivitas**:
   - Uji pada viewport desktop (`>1024px`), tablet (`768px-1023px`), dan mobile (`<767px`).
   - Pada layar kecil, ubah grid kolom menjadi susunan vertikal bertumpuk (`grid-template-columns: 1fr`).
7. **Jalankan Uji Otomatis**:
   - Jalankan `npm test` atau `node --test` untuk memastikan integritas logika tidak terganggu oleh perubahan tampilan.

---

## 🚫 Yang Harus Dihindari (Anti-Patterns)
- ❌ **Warna stabillo tajam tanpa transparansi** yang menyakitkan mata pada background gelap.
- ❌ **Border 1px solid putih murni (`#ffffff`)** — selalu gunakan `rgba(255, 255, 255, 0.08)` sampai `0.15`.
- ❌ **Mencampur aduk border-radius secara liar** (misal kartu luar tajam `4px` tetapi tombol dalamnya `30px`). Radius luar harus selalu sama atau lebih besar dari radius elemen anak di dalamnya.
- ❌ **Mengorbankan keterbacaan teks** demi efek visual (teks abu-abu terlalu gelap di atas background hitam).
- ❌ **Menghapus fungsionalitas tombol/input** saat menata ulang tata letak HTML.
