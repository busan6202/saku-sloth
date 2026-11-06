/* ==========================================================================
   KATALOG SAYURAN NUSANTARA (100+ komoditas) + sistem ikon hybrid
   --------------------------------------------------------------------------
   - Data katalog dipakai untuk memberi ikon otomatis pada produk sayur lokal.
   - Ikon hybrid: pakai PNG lokal di icons/vegetables/ bila tersedia, jika tidak
     tampilkan badge SVG (emoji + inisial + warna) sebagai fallback.
   - Token tersimpan di produk: "sayur:<id>" agar ikon bisa ikut berubah bila
     file gambar lokal ditambahkan di kemudian hari.
   ========================================================================== */
(() => {
    'use strict';

    const CATALOG = [
        // === 1. SAYURAN DAUN, PUCUK & PAKIS ===
        { id: 'kangkung', nama: 'Kangkung (Air/Darat)', kategori: 'Sayuran Daun', alias: ['kangkung cabut', 'kangkung potong'], warna: '#16a34a', emoji: '🥬' },
        { id: 'bayam-hijau', nama: 'Bayam Hijau', kategori: 'Sayuran Daun', alias: ['bayam cabut', 'bayam sekul'], warna: '#15803d', emoji: '🥬' },
        { id: 'bayam-merah', nama: 'Bayam Merah', kategori: 'Sayuran Daun', alias: ['bayam ungu'], warna: '#9d174d', emoji: '🌿' },
        { id: 'kelakai', nama: 'Kelakai / Pakis Merah', kategori: 'Sayuran Daun', alias: ['kalakai', 'pakis rawa', 'paku'], warna: '#b91c1c', emoji: '🌿' },
        { id: 'pakis-hijau', nama: 'Pakis Hijau / Paku Sayur', kategori: 'Sayuran Daun', alias: ['pucuk paku', 'pakis hutan'], warna: '#166534', emoji: '🌿' },
        { id: 'daun-singkong', nama: 'Daun Singkong', kategori: 'Sayuran Daun', alias: ['pucuk ubi', 'daun ketela'], warna: '#14532d', emoji: '🌿' },
        { id: 'daun-pepaya', nama: 'Daun Pepaya', kategori: 'Sayuran Daun', alias: ['pucuk kates', 'daun gandul'], warna: '#3f6212', emoji: '🌿' },
        { id: 'daun-katuk', nama: 'Daun Katuk', kategori: 'Sayuran Daun', alias: ['sayur katuk', 'pucuk manis', 'cangkok manis'], warna: '#15803d', emoji: '🌿' },
        { id: 'daun-kelor', nama: 'Daun Kelor', kategori: 'Sayuran Daun', alias: ['marungga', 'moringa'], warna: '#22c55e', emoji: '🌿' },
        { id: 'genjer', nama: 'Genjer / Eceng Padi', kategori: 'Sayuran Daun', alias: ['paku rawan', 'haleyo'], warna: '#4d7c0f', emoji: '🌱' },
        { id: 'daun-melinjo', nama: 'Daun Melinjo (So)', kategori: 'Sayuran Daun', alias: ['daun so', 'pucuk tangkil'], warna: '#65a30d', emoji: '🍃' },
        { id: 'sawi-hijau', nama: 'Sawi Hijau / Caisim', kategori: 'Sayuran Daun', alias: ['sawi bakso', 'cesim', 'caisim', 'sawi manis'], warna: '#22c55e', emoji: '🥬' },
        { id: 'sawi-putih', nama: 'Sawi Putih / Petsai', kategori: 'Sayuran Daun', alias: ['pecai', 'petsay', 'kubis cina'], warna: '#bef264', emoji: '🥬' },
        { id: 'pakcoy', nama: 'Pakcoy / Sawi Sendok', kategori: 'Sayuran Daun', alias: ['pokcoy', 'pocoy', 'bok choy', 'sawi daging'], warna: '#16a34a', emoji: '🥬' },
        { id: 'kailan', nama: 'Kailan / Brokoli Cina', kategori: 'Sayuran Daun', alias: ['baby kailan'], warna: '#15803d', emoji: '🥬' },
        { id: 'kubis-putih', nama: 'Kubis / Kol Putih', kategori: 'Sayuran Daun', alias: ['kol bulat', 'kol gepeng', 'kubis'], warna: '#86efac', emoji: '🥬' },
        { id: 'kubis-ungu', nama: 'Kubis / Kol Ungu', kategori: 'Sayuran Daun', alias: ['kol merah'], warna: '#7e22ce', emoji: '🥬' },
        { id: 'selada-keriting', nama: 'Selada Air / Keriting', kategori: 'Sayuran Daun', alias: ['lettuce', 'selada bokor', 'jembak', 'iceberg'], warna: '#4ade80', emoji: '🥗' },
        { id: 'daun-kenikir', nama: 'Daun Kenikir', kategori: 'Sayuran Daun', alias: ['ulam raja', 'suring'], warna: '#15803d', emoji: '🌿' },
        { id: 'daun-kemangi', nama: 'Daun Kemangi', kategori: 'Sayuran Daun', alias: ['surawung', 'kemangi lalap', 'basil'], warna: '#22c55e', emoji: '🌿' },
        { id: 'daun-pohpohan', nama: 'Daun Pohpohan', kategori: 'Sayuran Daun', alias: ['lalap pohpohan'], warna: '#166534', emoji: '🍃' },
        { id: 'daun-antanan', nama: 'Daun Pegagan / Antanan', kategori: 'Sayuran Daun', alias: ['kaki kuda', 'pegagan'], warna: '#15803d', emoji: '🍀' },
        { id: 'daun-beluntas', nama: 'Daun Beluntas', kategori: 'Sayuran Daun', alias: ['baruntas'], warna: '#3f6212', emoji: '🌿' },
        { id: 'daun-sembung', nama: 'Daun Sembung / Gonda', kategori: 'Sayuran Daun', alias: ['sayur gonda', 'daun ginseng'], warna: '#16a34a', emoji: '🌱' },
        { id: 'daun-talas', nama: 'Daun Talas / Lompong', kategori: 'Sayuran Daun', alias: ['batang talas', 'keladi', 'sulur keladi'], warna: '#15803d', emoji: '🍃' },
        { id: 'pucuk-labu', nama: 'Pucuk Labu / Waluh', kategori: 'Sayuran Daun', alias: ['daun labu kuning', 'pucuk jipang'], warna: '#4d7c0f', emoji: '🌿' },
        { id: 'pucuk-rotan', nama: 'Umbut Rotan / Pucuk Rotan', kategori: 'Sayuran Daun', alias: ['jahu', 'uwit', 'singkah uwei'], warna: '#a16207', emoji: '🎍' },
        { id: 'umbut-kelapa', nama: 'Umbut Kelapa / Sawit', kategori: 'Sayuran Daun', alias: ['singkah', 'umbut aren'], warna: '#fef08a', emoji: '🎋' },
        { id: 'rebung', nama: 'Rebung Bambu', kategori: 'Sayuran Daun', alias: ['tunas bambu', 'iwung'], warna: '#ca8a04', emoji: '🎍' },

        // === 2. SAYURAN BUAH & LABU-LABUAN ===
        { id: 'tomat-merah', nama: 'Tomat Merah / Sayur', kategori: 'Sayuran Buah', alias: ['tomat buah', 'tomat apel', 'tomat'], warna: '#dc2626', emoji: '🍅' },
        { id: 'tomat-hijau', nama: 'Tomat Hijau', kategori: 'Sayuran Buah', alias: ['tomat muda'], warna: '#65a30d', emoji: '🟢' },
        { id: 'tomat-ceri', nama: 'Tomat Ceri / Ranti', kategori: 'Sayuran Buah', alias: ['chung', 'tomat mawar', 'ranti', 'cherry tomato', 'tomat cherry'], warna: '#ef4444', emoji: '🍒' },
        { id: 'terong-ungu', nama: 'Terong Ungu Panjang', kategori: 'Sayuran Buah', alias: ['terung ungu', 'terong kopek', 'eggplant', 'aubergine'], warna: '#6b21a8', emoji: '🍆' },
        { id: 'terong-hijau', nama: 'Terong Hijau Panjang', kategori: 'Sayuran Buah', alias: ['terong tunjuk'], warna: '#4d7c0f', emoji: '🥒' },
        { id: 'terong-bulat', nama: 'Terong Bulat / Lalap', kategori: 'Sayuran Buah', alias: ['terong gelatik', 'terong engkol'], warna: '#15803d', emoji: '🟢' },
        { id: 'terong-asam', nama: 'Terong Asam / Rimba', kategori: 'Sayuran Buah', alias: ['terung dayak', 'terong kuning'], warna: '#eab308', emoji: '🟡' },
        { id: 'rimbang', nama: 'Rimbang / Takokak', kategori: 'Sayuran Buah', alias: ['cepoka', 'cempokak', 'terong pipit'], warna: '#16a34a', emoji: '🫛' },
        { id: 'leunca', nama: 'Leunca', kategori: 'Sayuran Buah', alias: ['ranti hitam', 'bobosa'], warna: '#166534', emoji: '🫐' },
        { id: 'pare', nama: 'Pare / Paria', kategori: 'Sayuran Buah', alias: ['peria', 'pare hijau', 'pare gajih'], warna: '#15803d', emoji: '🥒' },
        { id: 'oyong', nama: 'Oyong / Gambas', kategori: 'Sayuran Buah', alias: ['petola', 'sayur oyong'], warna: '#166534', emoji: '🥒' },
        { id: 'timun', nama: 'Mentimun / Timun', kategori: 'Sayuran Buah', alias: ['ketimun', 'timun lalap', 'timun suri', 'cucumber'], warna: '#22c55e', emoji: '🥒' },
        { id: 'labu-siam', nama: 'Labu Siam / Jipang', kategori: 'Sayuran Buah', alias: ['manisa', 'waluh jipang', 'baby labu'], warna: '#84cc16', emoji: '🍐' },
        { id: 'labu-kuning', nama: 'Labu Kuning / Waluh', kategori: 'Sayuran Buah', alias: ['labu parang', 'pumpkin'], warna: '#d97706', emoji: '🎃' },
        { id: 'labu-air', nama: 'Labu Air / Blonceng', kategori: 'Sayuran Buah', alias: ['labu putih', 'kukuk'], warna: '#a3e635', emoji: '🍐' },
        { id: 'jagung-manis', nama: 'Jagung Manis', kategori: 'Sayuran Buah', alias: ['jagung kulitan', 'jagung pipil', 'corn'], warna: '#eab308', emoji: '🌽' },
        { id: 'jagung-muda', nama: 'Jagung Muda / Putren', kategori: 'Sayuran Buah', alias: ['baby corn', 'janggel', 'soleng'], warna: '#facc15', emoji: '🌽' },
        { id: 'nangka-muda', nama: 'Nangka Muda (Gori)', kategori: 'Sayuran Buah', alias: ['tewel', 'gudeg', 'cubadak'], warna: '#ca8a04', emoji: '🍈' },
        { id: 'pepaya-muda', nama: 'Pepaya Muda (Kates)', kategori: 'Sayuran Buah', alias: ['kates muda', 'gandul'], warna: '#65a30d', emoji: '🍈' },
        { id: 'kluwih', nama: 'Kluwih / Keluwih', kategori: 'Sayuran Buah', alias: ['timbul', 'kulur'], warna: '#4d7c0f', emoji: '🍈' },
        { id: 'sukun', nama: 'Sukun Muda', kategori: 'Sayuran Buah', alias: ['buah sukun'], warna: '#65a30d', emoji: '🍈' },
        { id: 'belimbing-wuluh', nama: 'Belimbing Wuluh / Sayur', kategori: 'Sayuran Buah', alias: ['belimbing asam', 'limeng'], warna: '#84cc16', emoji: '🥒' },
        { id: 'okra', nama: 'Okra (Hijau/Merah)', kategori: 'Sayuran Buah', alias: ['bendi', 'jari putri'], warna: '#16a34a', emoji: '🌶️' },
        { id: 'zukini', nama: 'Zukini / Timun Jepang', kategori: 'Sayuran Buah', alias: ['zucchini', 'kyuri'], warna: '#14532d', emoji: '🥒' }
        ,

        // === 3. SAYURAN POLONG, BIJI & KACANG ===
        { id: 'kacang-panjang', nama: 'Kacang Panjang', kategori: 'Polong & Biji', alias: ['kacang sayur', 'lembayung', 'long bean', 'runner bean'], warna: '#15803d', emoji: '🫛' },
        { id: 'buncis', nama: 'Buncis (Biasa/Baby)', kategori: 'Polong & Biji', alias: ['baby buncis', 'buncis perancis', 'green bean', 'wax bean'], warna: '#22c55e', emoji: '🫛' },
        { id: 'kecipir', nama: 'Kecipir / Jaat', kategori: 'Polong & Biji', alias: ['kacang botol', 'kelongkang'], warna: '#4d7c0f', emoji: '🫛' },
        { id: 'kapri', nama: 'Kacang Kapri', kategori: 'Polong & Biji', alias: ['ercis', 'snow peas'], warna: '#4ade80', emoji: '🫛' },
        { id: 'edamame', nama: 'Edamame / Kedelai Jepang', kategori: 'Polong & Biji', alias: ['kacang bulu'], warna: '#16a34a', emoji: '🫛' },
        { id: 'petai', nama: 'Petai / Pete', kategori: 'Polong & Biji', alias: ['pete papan', 'pete kupas'], warna: '#65a30d', emoji: '🫛' },
        { id: 'jengkol', nama: 'Jengkol / Jering', kategori: 'Polong & Biji', alias: ['jering', 'lubi'], warna: '#78350f', emoji: '🌰' },
        { id: 'petai-cina', nama: 'Petai Cina / Lamtoro', kategori: 'Polong & Biji', alias: ['mlanding', 'peuteuy selong'], warna: '#4d7c0f', emoji: '🫛' },
        { id: 'buah-melinjo', nama: 'Buah Melinjo / Tangkil', kategori: 'Polong & Biji', alias: ['kulit melinjo', 'biji melinjo'], warna: '#dc2626', emoji: '🍒' },
        { id: 'kacang-merah', nama: 'Kacang Merah Segar', kategori: 'Polong & Biji', alias: ['kacang jogo', 'endul'], warna: '#991b1b', emoji: '🫘' },
        { id: 'kacang-tanah', nama: 'Kacang Tanah Kulit', kategori: 'Polong & Biji', alias: ['kacang tanah'], warna: '#b45309', emoji: '🥜' },
        { id: 'kacang-tolo', nama: 'Kacang Tolo / Tunggak', kategori: 'Polong & Biji', alias: ['kacang dadap'], warna: '#92400e', emoji: '🫘' },
        { id: 'tauge-panjang', nama: 'Tauge / Kecambah Panjang', kategori: 'Polong & Biji', alias: ['toge', 'cambah', 'tauge'], warna: '#fef08a', emoji: '🌱' },
        { id: 'tauge-pendek', nama: 'Tauge Pendek / Rawon', kategori: 'Polong & Biji', alias: ['cambah rawon', 'tauge soto'], warna: '#fde047', emoji: '🌱' },
        { id: 'tauge-kedelai', nama: 'Tauge Kedelai / Kongnamul', kategori: 'Polong & Biji', alias: ['kecambah dele'], warna: '#facc15', emoji: '🌱' },
        { id: 'koro', nama: 'Kacang Koro / Roay', kategori: 'Polong & Biji', alias: ['koro pedang', 'koro uceng'], warna: '#65a30d', emoji: '🫛' },

        // === 4. SAYURAN BUNGA & BATANG ===
        { id: 'brokoli', nama: 'Brokoli Hijau', kategori: 'Bunga & Batang', alias: ['broccoli'], warna: '#15803d', emoji: '🥦' },
        { id: 'kembang-kol', nama: 'Kembang Kol / Bunga Kol', kategori: 'Bunga & Batang', alias: ['blengker', 'cauliflower'], warna: '#f8fafc', emoji: '🥦' },
        { id: 'jantung-pisang', nama: 'Jantung Pisang', kategori: 'Bunga & Batang', alias: ['ontong', 'tuntut'], warna: '#881337', emoji: '🌺' },
        { id: 'kecombrang', nama: 'Bunga Kecombrang', kategori: 'Bunga & Batang', alias: ['honje', 'kincung', 'rias', 'sambuang'], warna: '#db2777', emoji: '🌺' },
        { id: 'bunga-pepaya', nama: 'Bunga Pepaya', kategori: 'Bunga & Batang', alias: ['kembang kates'], warna: '#bef264', emoji: '🌼' },
        { id: 'bunga-turi', nama: 'Bunga Turi (Putih/Merah)', kategori: 'Bunga & Batang', alias: ['kembang turi'], warna: '#f43f5e', emoji: '🌸' },
        { id: 'terubuk', nama: 'Sayur Terubuk / Telur Tebu', kategori: 'Bunga & Batang', alias: ['tebu telur', 'bunga tebu'], warna: '#eab308', emoji: '🌾' },
        { id: 'bunga-bawang', nama: 'Bunga Bawang / Tombak', kategori: 'Bunga & Batang', alias: ['kembang bawang', 'garlic shoot'], warna: '#22c55e', emoji: '🌱' },
        { id: 'asparagus', nama: 'Asparagus', kategori: 'Bunga & Batang', alias: ['rebung barat'], warna: '#16a34a', emoji: '🎋' },

        // === 5. SAYURAN UMBI & AKAR ===
        { id: 'wortel', nama: 'Wortel (Lokal/Brastagi)', kategori: 'Umbi & Akar', alias: ['wortel impor', 'baby carrot', 'carrot'], warna: '#ea580c', emoji: '🥕' },
        { id: 'kentang', nama: 'Kentang (Dieng/Tes/Baby)', kategori: 'Umbi & Akar', alias: ['kentang rendang', 'kentang granola', 'potato'], warna: '#ca8a04', emoji: '🥔' },
        { id: 'lobak-putih', nama: 'Lobak Putih', kategori: 'Umbi & Akar', alias: ['daikon', 'lobak soto'], warna: '#e2e8f0', emoji: '🥕' },
        { id: 'bit', nama: 'Umbi Bit / Beetroot', kategori: 'Umbi & Akar', alias: ['buah bit', 'beetroot'], warna: '#881337', emoji: '🟣' },
        { id: 'singkong', nama: 'Singkong / Ubi Kayu', kategori: 'Umbi & Akar', alias: ['ketela pohon', 'kaspe'], warna: '#78350f', emoji: '🥔' },
        { id: 'ubi-jalar', nama: 'Ubi Jalar (Kuning/Ungu/Cilembu)', kategori: 'Umbi & Akar', alias: ['ketela rambat', 'boled', 'mantang', 'ubi'], warna: '#9333ea', emoji: '🍠' },
        { id: 'talas-bogor', nama: 'Umbi Talas / Keladi', kategori: 'Umbi & Akar', alias: ['bote', 'kimpul', 'mbote', 'talas'], warna: '#6b21a8', emoji: '🥔' },
        { id: 'bengkuang', nama: 'Bengkuang / Besusu', kategori: 'Umbi & Akar', alias: ['bengkoang', 'sengkuang'], warna: '#d6d3d1', emoji: '🥔' },

        // === 6. CABAI, BAWANG, RIMPANG & BUMBU DAPUR ===
        { id: 'cabai-rawit-merah', nama: 'Cabai Rawit Merah', kategori: 'Cabai & Bumbu', alias: ['cabe rawit', 'cengek', 'lombok rawit', 'rawit merah', "bird's eye", 'birds eye'], warna: '#dc2626', emoji: '🌶️' },
        { id: 'cabai-rawit-hijau', nama: 'Cabai Rawit Hijau / Lalap', kategori: 'Cabai & Bumbu', alias: ['cabe cengek hijau', 'rawit putih', 'rawit hijau'], warna: '#16a34a', emoji: '🌶️' },
        { id: 'cabai-merah-keriting', nama: 'Cabai Merah Keriting', kategori: 'Cabai & Bumbu', alias: ['cmk', 'cabe keriting', 'cabai keriting', 'cayenne'], warna: '#b91c1c', emoji: '🌶️' },
        { id: 'cabai-merah-besar', nama: 'Cabai Merah Besar', kategori: 'Cabai & Bumbu', alias: ['cmb', 'lombok besar', 'cabai merah'], warna: '#ef4444', emoji: '🌶️' },
        { id: 'cabai-hijau-besar', nama: 'Cabai Hijau Besar / Keriting', kategori: 'Cabai & Bumbu', alias: ['lombok ijo', 'cabe ijo', 'cabai hijau'], warna: '#15803d', emoji: '🌶️' },
        { id: 'cabai-gendot', nama: 'Cabai Gendot / Habanero', kategori: 'Cabai & Bumbu', alias: ['cabe bendot', 'cabe dieng'], warna: '#f97316', emoji: '🫑' },
        { id: 'paprika', nama: 'Paprika (Merah/Hijau/Kuning)', kategori: 'Cabai & Bumbu', alias: ['bell pepper', 'capsicum'], warna: '#eab308', emoji: '🫑' },
        { id: 'bawang-merah', nama: 'Bawang Merah', kategori: 'Cabai & Bumbu', alias: ['brambang', 'bawang sumenep', 'shallot'], warna: '#9f1239', emoji: '🧅' },
        { id: 'bawang-putih', nama: 'Bawang Putih', kategori: 'Cabai & Bumbu', alias: ['bawang lanang', 'baput', 'garlic'], warna: '#f1f5f9', emoji: '🧄' },
        { id: 'bawang-bombay', nama: 'Bawang Bombay', kategori: 'Cabai & Bumbu', alias: ['bombay merah', 'bawang bombai', 'onion bombay', 'yellow onion'], warna: '#d97706', emoji: '🧅' },
        { id: 'bawang-dayak', nama: 'Bawang Dayak / Hutan', kategori: 'Cabai & Bumbu', alias: ['bawang tiwai', 'bawang berlian'], warna: '#be123c', emoji: '🧅' },
        { id: 'daun-bawang', nama: 'Daun Bawang / Prei', kategori: 'Cabai & Bumbu', alias: ['loncang', 'bawang prei', 'onclang', 'green onion', 'spring onion', 'leek', 'prei'], warna: '#22c55e', emoji: '🌿' },
        { id: 'kucai', nama: 'Daun Kucai', kategori: 'Cabai & Bumbu', alias: ['bawang kucai', 'chives', 'lokio'], warna: '#15803d', emoji: '🌿' },
        { id: 'seledri', nama: 'Daun Seledri / Sop', kategori: 'Cabai & Bumbu', alias: ['daun sop', 'sledri', 'celery'], warna: '#16a34a', emoji: '🌿' },
        { id: 'jahe', nama: 'Jahe', kategori: 'Cabai & Bumbu', alias: ['jahe gajah', 'jahe emprit', 'halia', 'ginger'], warna: '#d97706', emoji: '🫚' },
        { id: 'kunyit', nama: 'Kunyit / Kunir', kategori: 'Cabai & Bumbu', alias: ['kunyit putih', 'biang kunyit', 'turmeric'], warna: '#f59e0b', emoji: '🫚' },
        { id: 'lengkuas', nama: 'Lengkuas / Laos', kategori: 'Cabai & Bumbu', alias: ['laja', 'lengkuas muda', 'galangal'], warna: '#b45309', emoji: '🫚' },
        { id: 'kencur', nama: 'Kencur / Cikur', kategori: 'Cabai & Bumbu', alias: ['cekur'], warna: '#a16207', emoji: '🫚' },
        { id: 'temu-kunci', nama: 'Temu Kunci', kategori: 'Cabai & Bumbu', alias: ['kunci sayur bening'], warna: '#ca8a04', emoji: '🫚' },
        { id: 'serai', nama: 'Serai / Sereh Dapur', kategori: 'Cabai & Bumbu', alias: ['sereh', 'lemongrass'], warna: '#84cc16', emoji: '🎋' },
        { id: 'daun-salam', nama: 'Daun Salam', kategori: 'Cabai & Bumbu', alias: ['salam segar'], warna: '#166534', emoji: '🍃' },
        { id: 'daun-jeruk', nama: 'Daun Jeruk Purut', kategori: 'Cabai & Bumbu', alias: ['daun limau'], warna: '#22c55e', emoji: '🍃' },
        { id: 'daun-kunyit', nama: 'Daun Kunyit', kategori: 'Cabai & Bumbu', alias: ['daun kunir'], warna: '#4d7c0f', emoji: '🍃' },
        { id: 'daun-pandan', nama: 'Daun Pandan Wangi', kategori: 'Cabai & Bumbu', alias: ['pandan suji'], warna: '#15803d', emoji: '🌿' },
        { id: 'jeruk-nipis', nama: 'Jeruk Nipis / Limau', kategori: 'Cabai & Bumbu', alias: ['jeruk sambal', 'jeruk limo', 'jeruk purut'], warna: '#65a30d', emoji: '🍋' },
        { id: 'asam-jawa', nama: 'Asam Jawa / Asam Kandis', kategori: 'Cabai & Bumbu', alias: ['asem', 'asam gelugur', 'asam sunti'], warna: '#78350f', emoji: '🫘' },
        { id: 'kluwek', nama: 'Kluwek / Kepayang', kategori: 'Cabai & Bumbu', alias: ['pangi', 'bumbu rawon'], warna: '#27272a', emoji: '🌰' },
        { id: 'kemiri', nama: 'Kemiri Kupas / Bulat', kategori: 'Cabai & Bumbu', alias: ['muncang', 'tingkih'], warna: '#fef3c7', emoji: '🌰' },

        // === 7. JAMUR KONSUMSI ===
        { id: 'jamur-tiram', nama: 'Jamur Tiram Putih', kategori: 'Jamur', alias: ['jamur crispy', 'tiram cokelat'], warna: '#e2e8f0', emoji: '🍄' },
        { id: 'jamur-kuping', nama: 'Jamur Kuping', kategori: 'Jamur', alias: ['kuping hitam', 'lember'], warna: '#451a03', emoji: '🍄' },
        { id: 'jamur-merang', nama: 'Jamur Merang', kategori: 'Jamur', alias: ['jamur bulat'], warna: '#78716c', emoji: '🍄' },
        { id: 'jamur-enoki', nama: 'Jamur Enoki', kategori: 'Jamur', alias: ['jamur tauge', 'enokitake'], warna: '#fef9c3', emoji: '🍄' },
        { id: 'jamur-kancing', nama: 'Jamur Kancing / Champignon', kategori: 'Jamur', alias: ['button mushroom'], warna: '#d6d3d1', emoji: '🍄' },
        { id: 'jamur-sawit', nama: 'Jamur Sawit / Tankos', kategori: 'Jamur', alias: ['jamur janjang', 'kulat sawit'], warna: '#a8a29e', emoji: '🍄' },
        { id: 'kulat-pelawan', nama: 'Kulat / Jamur Hutan Lokal', kategori: 'Jamur', alias: ['kulat bantilung', 'kulat'], warna: '#b45309', emoji: '🍄' }
    ];
    // Ikon PNG lokal yang sudah tersedia (folder icons/vegetables, open-crop-icons).
    const LOCAL_PNG = {
        'wortel': 'carrot',
        'kentang': 'russet-potato',
        'tomat-merah': 'tomato',
        'tomat-ceri': 'cherry-tomato',
        'terong-ungu': 'eggplant',
        'timun': 'cucumber',
        'jagung-manis': 'corn',
        'brokoli': 'broccoli',
        'kembang-kol': 'cauliflower',
        'kubis-putih': 'green-cabbage',
        'sawi-putih': 'napa-cabbage',
        'sawi-hijau': 'collard-greens',
        'pakcoy': 'bok-choy',
        'selada-keriting': 'iceberg',
        'daun-kemangi': 'basil',
        'daun-bawang': 'green-onion',
        'kucai': 'leek',
        'seledri': 'celery',
        'bayam-hijau': 'spinach',
        'bayam-merah': 'red-chard',
        'kangkung': 'watercress',
        'cabai-rawit-merah': 'birds-eye-chili',
        'cabai-merah-keriting': 'cayenne-pepper',
        'paprika': 'red-bell-pepper',
        'bawang-merah': 'red-onion',
        'bawang-putih': 'garlic',
        'bawang-bombay': 'yellow-onion',
        'jahe': 'ginger',
        'kunyit': 'turmeric',
        'lengkuas': 'galangal',
        'serai': 'lemongrass',
        'kacang-panjang': 'runner-bean',
        'buncis': 'wax-bean'
    };

    const byId = new Map(CATALOG.map((item) => [item.id, item]));

    // Indeks pencocokan nama: id, nama (tanpa kurung), dan seluruh alias.
    const WORD_BOUNDARY_SAFE = /[.*+?^${}()|[\]\\]/g;
    function escapeRegex(text) {
        return text.replace(WORD_BOUNDARY_SAFE, '\\$&');
    }

    function buildPattern(item) {
        const tokens = new Set();
        const push = (value) => {
            const clean = String(value || '').toLowerCase().replace(/-/g, ' ').trim();
            if (clean.length >= 2) tokens.add(clean);
        };
        push(item.id);
        push(String(item.nama || '').replace(/\([^)]*\)/g, ' '));
        (item.alias || []).forEach(push);
        const source = [...tokens]
            .sort((a, b) => b.length - a.length)
            .map((token) => `\\b${escapeRegex(token)}\\b`)
            .join('|');
        return source ? new RegExp(source, 'i') : null;
    }

    const MATCH_INDEX = CATALOG.map((item) => ({ item, pattern: buildPattern(item) }));

    // Badge SVG otomatis: emoji + inisial + warna khas sayur.
    function fallbackSvg(item) {
        const safe = item || {};
        const inisial = String(safe.nama || '?')
            .replace(/[^a-zA-Z\s]/g, ' ')
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0] || '')
            .join('')
            .toUpperCase() || '?';
        const bg = /^#[0-9a-f]{3,8}$/i.test(safe.warna || '') ? safe.warna : '#10b981';
        const emoji = safe.emoji || '🌿';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="22" fill="${bg}" fill-opacity="0.18"/>
    <rect x="2" y="2" width="96" height="96" rx="20" fill="none" stroke="${bg}" stroke-width="3" stroke-opacity="0.5"/>
    <text x="50" y="46" font-family="Inter, sans-serif" font-size="34" text-anchor="middle" dominant-baseline="central">${emoji}</text>
    <rect x="14" y="68" width="72" height="20" rx="6" fill="${bg}"/>
    <text x="50" y="79" font-family="Inter, sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${inisial}</text>
</svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    // Ikon hybrid: pakai PNG lokal bila ada, selain itu badge SVG.
    function iconFor(item) {
        const target = item || {};
        const png = LOCAL_PNG[target.id];
        return {
            src: png ? `icons/vegetables/${png}.png` : fallbackSvg(target),
            fallback: fallbackSvg(target),
            isLocal: Boolean(png)
        };
    }

    // Cari entri katalog dari nama/alias produk.
    function findByName(name) {
        const raw = String(name || '').trim();
        if (raw.length < 2) return null;
        for (const entry of MATCH_INDEX) {
            if (entry.pattern && entry.pattern.test(raw)) return entry.item;
        }
        return null;
    }

    function findById(id) {
        return byId.get(String(id || '').trim().toLowerCase()) || null;
    }

    window.KATALOG_SAYUR_NUSANTARA = CATALOG;
    window.SayurIcons = {
        items: CATALOG,
        byId: findById,
        findByName,
        fallbackSvg,
        iconFor,
        tokenFor: (item) => `sayur:${item.id}`
    };
})();
