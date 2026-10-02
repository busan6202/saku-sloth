const API_URL = 'http://localhost:5000/api/transactions';

// Ambil elemen HTML
const transactionForm = document.getElementById('transaction-form');
const transactionList = document.getElementById('transaction-list');
const totalBalance = document.getElementById('total-balance');

// Fungsi untuk memuat data dari server
async function fetchTransactions() {
    try {
        const response = await fetch(API_URL);
        const transactions = await response.json();
        renderTransactions(transactions);
    } catch (error) {
        console.error("Gagal mengambil data:", error);
    }
}

// Fungsi menampilkan data ke layar & menghitung total saldo
function renderTransactions(transactions) {
    transactionList.innerHTML = '';
    
    if (transactions.length === 0) {
        transactionList.innerHTML = `<li class="empty-state">Belum ada catatan. Santai dulu! 🦥</li>`;
        totalBalance.innerText = `Rp 0`;
        return;
    }

    let balance = 0;

    transactions.forEach(trx => {
        const amountNum = Number(trx.amount);
        if (trx.type === 'income') {
            balance += amountNum;
        } else {
            balance -= amountNum;
        }

        const li = document.createElement('li');
        li.className = trx.type;
        li.innerHTML = `
            <span>${trx.desc}</span>
            <strong>${trx.type === 'income' ? '+' : '-'} Rp ${amountNum.toLocaleString('id-ID')}</strong>
        `;
        transactionList.appendChild(li);
    });

    totalBalance.innerText = `Rp ${balance.toLocaleString('id-ID')}`;
}

// Event saat form disubmit (Simpan data)
transactionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const desc = document.getElementById('desc').value;
    const amount = document.getElementById('amount').value;
    const type = document.getElementById('type').value;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ desc, amount, type })
        });

        if (response.ok) {
            transactionForm.reset();
            fetchTransactions(); // Muat ulang data terbaru
        }
    } catch (error) {
        console.error("Gagal menyimpan data:", error);
    }
});

// Muat data saat halaman dibuka
fetchTransactions();