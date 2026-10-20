# ui-sensei — Project Design Decisions

## Global
- Palette: base anti-slop, palet kustom hangat **"editorial ledger"** — light: page `#F3F1EC`, surface `#FBF9F5`, surface-soft `#ECE9E1`, ink `#1D1C18`, muted `#6F6A5E`, line `#DDD9CF`, accent vermilion `#E05A24`, green/income `#3D8A5F`, red/expense `#C24B3E`, amber `#C9921F`; dark: page `#141310`, surface `#1D1B17`, surface-soft `#282520`, ink `#F2F0E9`, muted `#9B9589`, line `#33302A`, accent `#FF7A3D`, green `#63C08A`, red `#EF8A7D`, amber `#D9A840`
- Typography: system-native stack (`-apple-system` SF Pro Display/Text, Segoe UI, Roboto) untuk keterbacaan maksimal di smartphone ala tampilan iPhone; angka memakai `font-variant-numeric: tabular-nums`; tanpa webfont eksternal agar lebih cepat di mobile
- Shadow: tinted ke arah hue background (anti-slop), kartu balance memakai shadow tinted accent
- Last updated: 2026-10-20

## Categories

### page
- Base source: anti-slop.md
- Punctual contributions: ui-ux-pro-max.md (spacing scale, tabular-nums, touch-target 40px+, kontras dark mode)
- Dials: variance 8, motion 6, density 4
- Active lenses: none
- Variants:
  - dashboard (default): layout asimetris, hero split, whitespace lebar
  - auth: kartu terpusat (pengecualian centered-hero: konten pesan/otentikasi)
- Notes: angka finansial selalu `font-variant-numeric: tabular-nums`; `text-wrap: balance` pada heading
- Last updated: 2026-10-20

### card
- Base source: anti-slop.md
- Punctual contributions: none
- Dials: variance 8, motion 6, density 4
- Active lenses: none
- Variants:
  - default: hairline border, tanpa shadow (elevasi hanya jika hierarki membutuhkan), radius 16px
  - balance: panel ink pekat (light) / paper (dark) — "inverted card", shadow tinted accent, dekorasi bar skew
- Notes: hindari membungkus konten dalam kartu secara refleks — gunakan pembagi garis atas/batas bila cukup
- Last updated: 2026-10-20

### button
- Base source: anti-slop.md
- Punctual contributions: emil-design-eng.md (ease-out 150-300ms, transform/opacity saja)
- Dials: variance 8, motion 6, density 4
- Active lenses: none
- Variants:
  - primary: isi accent vermilion + teks ink, hover naik 1px + accent-deep
  - secondary: surface + hairline border
  - ghost: text-button, teks accent
  - icon: persegi 37px hairline, hover border accent
- Notes: `touch-action: manipulation`; `:focus-visible` outline accent 2px offset 2px
- Last updated: 2026-10-20

### nav
- Base source: anti-slop.md
- Punctual contributions: none
- Dials: variance 8, motion 6, density 4
- Active lenses: none
- Variants:
  - sidebar (default): fixed 246px, indicator kiri 2px accent pada link aktif
  - mobile: bottom nav blur, tombol tengah accent
- Last updated: 2026-10-20

### form
- Base source: anti-slop.md
- Punctual contributions: ui-ux-pro-max.md (spacing scale, kontras, autocomplete/name)
- Dials: variance 8, motion 6, density 4
- Active lenses: none
- Variants:
  - default: input hairline di atas surface-soft, tinggi 41px, radius 8px
  - type-switch: segmented control radius 9px
- Notes: label membungkus kontrol (pattern lama dipertahankan); error inline
- Last updated: 2026-10-20

### dialog
- Base source: anti-slop.md
- Punctual contributions: emil-design-eng.md (origin-aware, durasi <300ms, ease-out)
- Dials: variance 8, motion 6, density 4
- Active lenses: none
- Variants:
  - default: 440px, hairline border, backdrop blur + gelap, radius 17px
- Notes: `overscroll-behavior: contain` pada konten dialog
- Last updated: 2026-10-20