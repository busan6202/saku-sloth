const API_URL = 'http://localhost:5000/api/transactions'; // Sesuaikan jika sudah di-deploy

const transactionForm = document.getElementById('transaction-form');
const transactionList = document.getElementById('transaction-list');
const totalBalance = document.getElementById('total-balance');

let expenseChartInstance = null;

// Fungsi untuk memuat data dari server
async function fetchTransactions() {
    try {
        const response = await fetch(API_URL);
        const transactions = await response.json();
        renderTransactions(transactions);
        updateChart(transactions);
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
            <div>
                <span>${trx.desc}</span>
                <br><small style="color: #7f8c8d; font-size: 0.75rem;">📁 ${trx.category || 'Umum'}</small>
            </div>
            <strong>${trx.type === 'income' ? '+' : '-'} Rp ${amountNum.toLocaleString('id-ID')}</strong>
        `;
        transactionList.appendChild(li);
    });

    totalBalance.innerText = `Rp ${balance.toLocaleString('id-ID')}`;
}

// Fungsi Memperbarui Pie Chart Berdasarkan Kategori Pengeluaran
function updateChart(transactions) {
    // Filter hanya transaksi pengeluaran (expense)
    const expenses = transactions.filter(trx => trx.type === 'expense');
    
    // Kelompokkan total nominal berdasarkan kategori
    const categoryTotals = {};
    expenses.forEach(trx => {
        const cat = trx.category || 'Lainnya';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + Number(trx.amount);
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);

    const ctx = document.getElementById('expenseChart').getContext('2d');

    if (expenseChartInstance) {
        expenseChartInstance.destroy(); // Hapus chart lama sebelum membuat ulang
    }

    if (labels.length === 0) {
        // Jika belum ada pengeluaran, tampilkan chart kosong dummy
        expenseChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Belum ada pengeluaran'],
                datasets: [{ data: [1], backgroundColor: ['#e0e0e0'] }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
        return;
    }

    // Palet warna Earth Tone SlothUI
    const earthToneColors = ['#52796f', '#354f52', '#84a98c', '#cad2c5', '#bc4749', '#dda15e', '#606c38'];

    expenseChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: earthToneColors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        font: { size: 11, family: 'Plus Jakarta Sans' }
                    }
                }
            }
        }
    });
}

// Event saat form disubmit
transactionForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const desc = document.getElementById('desc').value;
    const amount = document.getElementById('amount').value;
    const type = document.getElementById('type').value;
    const category = document.getElementById('category').value;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ desc, amount, type, category })
        });

        if (response.ok) {
            transactionForm.reset();
            fetchTransactions();
        }
    } catch (error) {
        console.error("Gagal menyimpan data:", error);
    }
});

// Muat data saat halaman dibuka
fetchTransactions();