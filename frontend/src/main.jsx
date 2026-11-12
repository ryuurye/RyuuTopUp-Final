import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase, isSupabaseConfigured } from './supabase';
import { api, formatRupiah } from './api';
import './style.css';

const MIDTRANS_CLIENT_KEY = import.meta.env.VITE_MIDTRANS_CLIENT_KEY;
const MIDTRANS_LIVE = String(import.meta.env.VITE_MIDTRANS_IS_PRODUCTION).toLowerCase() === 'true';
const MIDTRANS_SCRIPT = MIDTRANS_LIVE ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [brands, setBrands] = useState([]);
  const [visibleBrands, setVisibleBrands] = useState(48);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [brandProducts, setBrandProducts] = useState([]);
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandError, setBrandError] = useState('');
  const [brandSearch, setBrandSearch] = useState('');
  const [brandType, setBrandType] = useState('Semua');
  const [visibleVariants, setVisibleVariants] = useState(60);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState('Semua');
  const [search, setSearch] = useState('');
  const [activePage, setActivePage] = useState('home');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [selected, setSelected] = useState(null);
  const [target, setTarget] = useState('');
  const [zone, setZone] = useState('');
  const [additionalData, setAdditionalData] = useState({});
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [orders, setOrders] = useState([]);
  const [ordersBusy, setOrdersBusy] = useState(false);
  const [adminOrders, setAdminOrders] = useState([]);
  const [refundRequests, setRefundRequests] = useState([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);

  const token = session?.access_token;
  const isAdmin = profile?.role === 'admin';
  const selectedFormFields = Array.isArray(selected?.inquiry_form?.fields) ? selected.inquiry_form.fields : [];
  const selectedTargetField = selectedFormFields[0];
  const selectedZoneField = selectedFormFields[1];
  const showZoneField = Boolean(selectedZoneField) || (selected && classify(selected) === 'Game');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setProfile(null); setOrders([]); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { loadCatalog(); }, []);
  useEffect(() => { if (token) loadProfile(); }, [token]);
  useEffect(() => { if (token && activePage === 'orders') loadOrders(); }, [token, activePage]);
  useEffect(() => { if (token && activePage === 'admin' && isAdmin) loadAdmin(); }, [token, activePage, isAdmin]);
  useEffect(() => {
    const orderCode = new URLSearchParams(window.location.search).get('order');
    if (orderCode) setActivePage('orders');
  }, []);

  async function loadCatalog() {
    setLoadingProducts(true); setLoadError('');
    try {
      // Only the brand list is loaded here; denominations are loaded when a brand is opened.
      const data = await api('/api/brands');
      setBrands(data.brands || []);
    } catch (error) { setLoadError(error.message); }
    finally { setLoadingProducts(false); }
  }
  async function openBrand(brand) {
    setSelectedBrand(brand); setBrandProducts([]); setBrandSearch(''); setBrandType('Semua');
    setVisibleVariants(60); setBrandError(''); setBrandLoading(true);
    try {
      const PAGE = 1000;
      const all = [];
      for (let offset = 0; offset < 20000; offset += PAGE) {
        const data = await api(`/api/catalog?brand=${encodeURIComponent(brand.brand)}&limit=${PAGE}&offset=${offset}`);
        const batch = data.products || [];
        all.push(...batch);
        if (!data.has_more || !batch.length) break;
      }
      setBrandProducts(all);
    } catch (error) { setBrandError(error.message); }
    finally { setBrandLoading(false); }
  }
  async function loadProfile() {
    try {
      const data = await api('/api/me', { token });
      setProfile(data.profile || null);
    } catch { setProfile(null); }
  }
  async function loadOrders() {
    setOrdersBusy(true);
    try { const data = await api('/api/orders', { token }); setOrders(data.orders || []); }
    catch (error) { setLoadError(error.message); }
    finally { setOrdersBusy(false); }
  }
  async function loadAdmin() {
    setAdminBusy(true); setAdminMessage('');
    try {
      const [orderData, refundData] = await Promise.all([
        api('/api/admin/orders', { token }),
        api('/api/admin/refund-requests', { token }),
      ]);
      setAdminOrders(orderData.orders || []);
      setRefundRequests(refundData.refund_requests || []);
    } catch (error) { setAdminMessage(error.message); }
    finally { setAdminBusy(false); }
  }

  const categories = useMemo(() => {
    const all = new Set();
    brands.forEach(b => all.add(classify({ category_name: b.category_name, brand_name: b.brand })));
    return ['Semua', ...['Game', 'Pulsa', 'E-Wallet', 'Voucher', 'Lainnya'].filter(x => all.has(x))];
  }, [brands]);
  const filtered = useMemo(() => brands.filter(b => {
    const matchesCategory = category === 'Semua' || classify({ category_name: b.category_name, brand_name: b.brand }) === category;
    const term = search.toLowerCase().trim();
    const matchesSearch = !term || `${b.brand} ${b.category_name || ''}`.toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
  }), [brands, category, search]);
  useEffect(() => { setVisibleBrands(48); }, [category, search]);
  useEffect(() => { setVisibleVariants(60); }, [brandSearch, brandType]);
  const brandTypes = useMemo(() => {
    const types = [...new Set(brandProducts.map(p => p.type_name).filter(Boolean))];
    return types.length > 1 && types.length <= 14 ? ['Semua', ...types] : [];
  }, [brandProducts]);
  const filteredVariants = useMemo(() => {
    const term = brandSearch.toLowerCase().trim();
    return brandProducts.filter(p => (brandType === 'Semua' || p.type_name === brandType) && (!term || `${p.product_name} ${p.type_name || ''}`.toLowerCase().includes(term)));
  }, [brandProducts, brandSearch, brandType]);

  function classify(p) {
    const s = `${p.category_name || ''} ${p.brand_name || ''} ${p.product_name || ''} ${p.type_name || ''}`.toLowerCase();
    if (/pulsa|telkomsel|indosat|xl|axis|by\.u|smartfren|tri|telepon/.test(s)) return 'Pulsa';
    if (/e-wallet|ewallet|e wallet|dana|ovo|gopay|shopeepay|linkaja|saldo/.test(s)) return 'E-Wallet';
    if (/voucher|steam|google play|itunes|gift card|wifi|pln|token listrik/.test(s)) return 'Voucher';
    if (/game|games|mobile legends|free fire|pubg|valorant|roblox|genshin|honor of kings|8 ball/.test(s)) return 'Game';
    if (/game/.test((p.category_name || '').toLowerCase())) return 'Game';
    return 'Lainnya';
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!supabase) { setAuthMessage('Konfigurasi Supabase belum lengkap.'); return; }
    setAuthBusy(true); setAuthMessage('');
    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: fullName } } });
        if (error) throw error;
        if (data.session) { setSession(data.session); setAuthOpen(false); }
        else setAuthMessage('Akun dibuat. Periksa email untuk verifikasi, lalu masuk.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
        setSession(data.session); setAuthOpen(false); setAuthPassword('');
      }
    } catch (error) { setAuthMessage(error.message); }
    finally { setAuthBusy(false); }
  }
  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null); setProfile(null); setActivePage('home');
  }
  function openPurchase(product) {
    setSelected(product); setTarget(''); setZone(''); setAdditionalData({}); setCheckoutError('');
    if (!session) { setAuthOpen(true); setCheckoutError('Masuk atau daftar terlebih dahulu untuk membuat pesanan.'); }
  }

  function loadSnapScript() {
    return new Promise((resolve, reject) => {
      if (window.snap) return resolve(window.snap);
      if (!MIDTRANS_CLIENT_KEY) return reject(new Error('Midtrans Client Key belum diatur di Netlify.'));
      const script = document.createElement('script');
      script.src = MIDTRANS_SCRIPT;
      script.setAttribute('data-client-key', MIDTRANS_CLIENT_KEY);
      script.onload = () => window.snap ? resolve(window.snap) : reject(new Error('Midtrans Snap tidak dapat dimuat.'));
      script.onerror = () => reject(new Error('Gagal memuat halaman pembayaran Midtrans.'));
      document.body.appendChild(script);
    });
  }
  async function checkout(event) {
    event.preventDefault();
    if (!selected || !token) return;
    setCheckoutBusy(true); setCheckoutError('');
    try {
      const created = await api('/api/orders', { token, method: 'POST', body: { sku_code: selected.sku_code, target, target_zone: zone, additional_data: additionalData } });
      setSelected(null); setSelectedBrand(null); setActivePage('orders'); await loadOrders();
      const snap = await loadSnapScript();
      snap.pay(created.snap_token, {
        onSuccess: async () => { setActivePage('orders'); await loadOrders(); alert('Pembayaran berhasil diterima. Top-up sedang diproses.'); },
        onPending: async () => { setActivePage('orders'); await loadOrders(); alert('Pembayaran menunggu konfirmasi.'); },
        onError: async () => { setActivePage('orders'); await loadOrders(); alert('Pembayaran gagal. Periksa status pesanan.'); },
        onClose: async () => { setActivePage('orders'); await loadOrders(); },
      });
    } catch (error) { setCheckoutError(error.message); }
    finally { setCheckoutBusy(false); }
  }

  async function submitTwoFactor(order, code) {
    try {
      const result = await api(`/api/orders/${order.id}/2fa`, { token, method: 'POST', body: { code } });
      alert(result.message || 'Kode diteruskan ke penyedia. Status validasi akan diperbarui melalui callback.');
      await loadOrders();
      return true;
    } catch (error) {
      alert(error.message);
      return false;
    }
  }

  async function requestRefund(order) {
    const reason = window.prompt('Tuliskan alasan permintaan refund:');
    if (!reason) return;
    try {
      await api(`/api/orders/${order.id}/refund`, { token, method: 'POST', body: { reason } });
      alert('Permintaan refund tercatat dan menunggu admin.'); await loadOrders();
    } catch (error) { alert(error.message); }
  }
  async function syncCatalogue() {
    setAdminBusy(true); setAdminMessage('Memulai sinkronisasi katalog Melo H2H…');
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      let cursor = null, runStartedAt = null, totalSeen = 0, chunk = 0, result = null;
      do {
        let attempt = 0;
        for (;;) {
          try {
            result = await api('/api/admin/catalog/sync', { token, method: 'POST', body: { cursor, run_started_at: runStartedAt, total_seen: totalSeen } });
            break;
          } catch (error) {
            // Each chunk is idempotent (upsert), so a transient failure can safely be retried.
            attempt += 1;
            if (attempt >= 5) throw new Error(`${error.message} (berhenti di bagian ${chunk + 1}; ${totalSeen} SKU sudah tersimpan, tunggu 1 menit lalu klik sinkronkan lagi)`);
            const limited = /rate limit|too many/i.test(error.message);
            const delay = limited ? 12000 : 2000 * attempt;
            setAdminMessage(`Bagian ${chunk + 1} ${limited ? 'menunggu batas kecepatan Melo' : 'gagal'} (${error.message}). Mengulang ${attempt}/4 dalam ${Math.round(delay / 1000)} detik…`);
            await wait(delay);
          }
        }
        chunk += 1;
        cursor = result.next_cursor;
        runStartedAt = result.run_started_at;
        totalSeen = result.total_seen;
        setAdminMessage(`Menyinkronkan katalog… bagian ${chunk}, ${totalSeen} SKU tersimpan.`);
        // Melo allows 20 pricelist requests per minute: keep a steady pace (~17/min).
        if (result.has_more) await wait(3500);
      } while (result.has_more);
      setAdminMessage(`Selesai: ${totalSeen} SKU disinkronkan dari ${result.brands} brand dalam ${chunk} bagian. ${result.deactivated ?? 0} SKU lama dinonaktifkan.`);
      await loadCatalog(); await loadAdmin();
    } catch (error) { setAdminMessage(error.message); }
    finally { setAdminBusy(false); }
  }
  async function triggerRefund(order) {
    if (!window.confirm(`Ajukan refund Midtrans untuk ${order.order_code}?`)) return;
    setAdminBusy(true);
    try {
      const result = await api(`/api/admin/orders/${order.id}/refund`, { token, method: 'POST', body: {} });
      setAdminMessage(result.outcome?.submitted ? 'Refund dikirim ke Midtrans; status akhir menunggu notifikasi.' : 'Refund memerlukan pemeriksaan manual. Lihat catatan pesanan.');
      await loadAdmin();
    } catch (error) { setAdminMessage(error.message); }
    finally { setAdminBusy(false); }
  }
  async function markRefunded(order) {
    const reference = window.prompt('Masukkan nomor referensi refund dari dashboard Midtrans atau bukti transfer:');
    if (!reference) return;
    setAdminBusy(true);
    try {
      await api(`/api/admin/orders/${order.id}/mark-refunded`, { token, method: 'POST', body: { reference } });
      setAdminMessage('Pesanan ditandai refunded. Simpan bukti refund sesuai nomor referensi.'); await loadAdmin();
    } catch (error) { setAdminMessage(error.message); }
    finally { setAdminBusy(false); }
  }
  async function reconcile(order) {
    setAdminBusy(true);
    try {
      const result = await api(`/api/admin/orders/${order.id}/reconcile`, { token, method: 'POST', body: {} });
      setAdminMessage(`Status Melo diperbarui: ${result.status}.`); await loadAdmin();
    } catch (error) { setAdminMessage(error.message); }
    finally { setAdminBusy(false); }
  }

  return <div className="app-shell">
    <div className="announcement">Top up digital lebih praktis · Pembayaran aman melalui Midtrans</div>
    <header className="site-header">
      <a className="brand" href="#home" onClick={() => setActivePage('home')}><span className="brand-mark">R</span><span>Ryuu<span className="brand-light">TopUp</span><small>TOP UP • DIGITAL GOODS</small></span></a>
      <nav className={mobileMenu ? 'nav-links open' : 'nav-links'}>
        <button className={activePage === 'home' ? 'nav-active' : ''} onClick={() => { setActivePage('home'); setMobileMenu(false); }}>Beranda</button>
        <button onClick={() => { setCategory('Game'); setActivePage('home'); setMobileMenu(false); }}>Game</button>
        <button onClick={() => { setCategory('Pulsa'); setActivePage('home'); setMobileMenu(false); }}>Pulsa</button>
        <button onClick={() => { setCategory('E-Wallet'); setActivePage('home'); setMobileMenu(false); }}>E-Wallet</button>
        {session && <button className={activePage === 'orders' ? 'nav-active' : ''} onClick={() => { setActivePage('orders'); setMobileMenu(false); }}>Pesanan</button>}
        {isAdmin && <button className={activePage === 'admin' ? 'nav-active' : ''} onClick={() => { setActivePage('admin'); setMobileMenu(false); }}>Admin</button>}
      </nav>
      <div className="header-actions">
        {session ? <><button className="account-btn" onClick={() => setActivePage('orders')}><span className="avatar">{(session.user.email || 'R')[0].toUpperCase()}</span><span className="account-email">{session.user.email}</span></button><button className="outline-btn small" onClick={signOut}>Keluar</button></> : <button className="primary-btn small" onClick={() => { setAuthMessage(''); setAuthOpen(true); }}>Masuk / Daftar</button>}
      </div>
      <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu">☰</button>
    </header>

    <main>
      {activePage === 'home' && <>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="pulse-dot"></span> DIGITAL TOP-UP STORE</span>
            <h1>Isi ulang cepat.<br/><em>Jalani game-mu.</em></h1>
            <p>Temukan kebutuhan game, pulsa, e-wallet, dan voucher digital dalam satu tempat. Pilih produk, masukkan tujuan, lalu lanjutkan pembayaran.</p>
            <div className="hero-actions"><button className="primary-btn" onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>Jelajahi produk <span>→</span></button><span className="secure-note"><span className="secure-icon">✓</span> Checkout melalui Midtrans</span></div>
            <div className="hero-stats"><div><b>4 kategori</b><span>produk digital</span></div><div><b>24/7</b><span>pemesanan online</span></div><div><b>Real-time</b><span>status pesanan</span></div></div>
          </div>
          <div className="hero-art"><div className="orbit orbit-one"></div><div className="orbit orbit-two"></div><div className="hero-card card-main"><span className="card-label">YOUR DIGITAL HUB</span><div className="hero-emblem">R<span>+</span></div><strong>Level up<br/>your day.</strong><small>RYUUTOPUP / 2026</small></div><div className="floating-chip chip-top"><span>✦</span> Game credits</div><div className="floating-chip chip-bottom"><span>↗</span> Fast checkout</div><div className="hero-spark spark-one">✳</div><div className="hero-spark spark-two">✧</div></div>
        </section>

        <section className="trust-strip"><div><span className="trust-icon">◈</span><span><b>Proses terstruktur</b><small>Status pesanan tercatat</small></span></div><div><span className="trust-icon">⌁</span><span><b>Pembayaran tepercaya</b><small>Didukung Midtrans</small></span></div><div><span className="trust-icon">◎</span><span><b>Produk digital</b><small>Game hingga e-wallet</small></span></div></section>

        <section className="catalog-section" id="catalog">
          <div className="section-heading"><div><span className="eyebrow">PILIH KEBUTUHANMU</span><h2>Temukan produk</h2><p>Pilih brand, lalu pilih nominal atau paket yang kamu butuhkan.</p></div><div className="catalog-count">{brands.length ? `${brands.length} brand tersedia` : 'Katalog produk'}</div></div>
          <div className="catalog-tools"><div className="category-tabs">{categories.map(c => <button key={c} className={category === c ? 'category-active' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div><label className="search-box"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari brand, misalnya DANA atau Mobile Legends..."/><kbd>⌘ K</kbd></label></div>
          {loadingProducts ? <div className="empty-state"><div className="loader"></div><b>Memuat katalog produk…</b><span>Mengambil produk aktif dari server.</span></div> : loadError ? <div className="error-panel"><b>Katalog belum dapat dimuat</b><p>{loadError}</p><button className="outline-btn" onClick={loadCatalog}>Coba lagi</button></div> : filtered.length ? <><div className="product-grid">{filtered.slice(0, visibleBrands).map(b => <BrandCard key={b.brand} brand={b} onOpen={() => openBrand(b)}/>)}</div>{filtered.length > visibleBrands && <div className="load-more-wrap"><button className="outline-btn" onClick={() => setVisibleBrands(n => n + 48)}>Tampilkan lebih banyak ({filtered.length - visibleBrands} brand lagi)</button></div>}</> : <div className="empty-state"><div className="empty-icon">⌕</div><b>Brand tidak ditemukan</b><span>Coba kata kunci atau kategori lain.</span></div>}
          <p className="catalog-footnote">Harga ditampilkan dalam Rupiah dan dapat berubah mengikuti katalog penyedia. Ketersediaan akhir mengikuti status produk saat checkout.</p>
        </section>
      </>}

      {activePage === 'orders' && <OrdersPage orders={orders} loading={ordersBusy} onRefresh={loadOrders} onRefund={requestRefund} onTwoFactor={submitTwoFactor}/>}
      {activePage === 'admin' && isAdmin && <AdminPage orders={adminOrders} refunds={refundRequests} busy={adminBusy} message={adminMessage} onSync={syncCatalogue} onRefund={triggerRefund} onReconcile={reconcile} onMarkRefunded={markRefunded} onRefresh={loadAdmin}/>}
    </main>

    <footer className="footer"><div className="footer-top"><a className="brand" href="#home"><span className="brand-mark">R</span><span>Ryuu<span className="brand-light">TopUp</span><small>TOP UP • DIGITAL GOODS</small></span></a><p>One place for your digital needs.</p></div><div className="footer-bottom"><span>© {new Date().getFullYear()} RyuuTopUp. All rights reserved.</span><span>Secure checkout · Digital products</span></div></footer>

    {selectedBrand && <Modal wide onClose={() => setSelectedBrand(null)}><div className="brand-head"><div className={`product-avatar ${classNameFor({ category_name: selectedBrand.category_name, brand_name: selectedBrand.brand })}`}>{productInitial({ brand_name: selectedBrand.brand })}</div><div><div className="modal-kicker">PILIH NOMINAL / PAKET</div><h2>{selectedBrand.brand}</h2><small>{brandLoading ? 'Memuat pilihan…' : `${brandProducts.length} pilihan tersedia`}</small></div></div>{brandError ? <div className="error-panel"><b>Pilihan belum dapat dimuat</b><p>{brandError}</p><button className="outline-btn" onClick={() => openBrand(selectedBrand)}>Coba lagi</button></div> : brandLoading ? <div className="empty-state"><div className="loader"></div><b>Memuat pilihan {selectedBrand.brand}…</b></div> : <><div className="variant-tools"><label className="search-box"><span>⌕</span><input value={brandSearch} onChange={e => setBrandSearch(e.target.value)} placeholder={`Cari di ${selectedBrand.brand}…`}/></label>{brandTypes.length > 0 && <div className="variant-chips">{brandTypes.map(t => <button key={t} className={brandType === t ? 'chip-active' : ''} onClick={() => setBrandType(t)}>{t}</button>)}</div>}</div>{filteredVariants.length ? <div className="variant-list">{filteredVariants.slice(0, visibleVariants).map(p => <button key={p.sku_code} className="variant-row" onClick={() => openPurchase(p)}><span><span className="variant-name">{p.product_name}</span>{p.type_name && <span className="variant-meta">{p.type_name}</span>}</span><span className="variant-price">{formatRupiah(p.selling_price)}</span></button>)}{filteredVariants.length > visibleVariants && <button className="outline-btn" onClick={() => setVisibleVariants(n => n + 60)}>Tampilkan lebih banyak ({filteredVariants.length - visibleVariants} lagi)</button>}</div> : <div className="empty-state"><div className="empty-icon">⌕</div><b>Pilihan tidak ditemukan</b><span>Coba kata kunci lain.</span></div>}</>}</Modal>}

    {authOpen && <Modal onClose={() => setAuthOpen(false)}><div className="modal-kicker">WELCOME TO RYUU</div><h2>{authMode === 'login' ? 'Masuk ke akunmu' : 'Buat akun baru'}</h2><p className="modal-subtitle">Kelola pesanan dan lanjutkan top-up dari satu akun.</p><form className="form-stack" onSubmit={submitAuth}>{authMode === 'register' && <label>Nama lengkap<input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Nama kamu" required/></label>}<label>Email<input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="nama@email.com" autoComplete="email" required/></label><label>Password<input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="Minimal 6 karakter" minLength={6} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required/></label>{authMessage && <div className="inline-message">{authMessage}</div>}<button className="primary-btn full" disabled={authBusy}>{authBusy ? 'Memproses…' : authMode === 'login' ? 'Masuk' : 'Daftar akun'}</button></form><div className="auth-switch">{authMode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'} <button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthMessage(''); }}>{authMode === 'login' ? 'Daftar' : 'Masuk'}</button></div></Modal>}

    {selected && <Modal onClose={() => { if (!checkoutBusy) setSelected(null); }}><div className="modal-kicker">CHECKOUT PRODUCT</div><h2>Konfirmasi pesanan</h2><div className="checkout-product"><div className="product-avatar">{productInitial(selected)}</div><div><b>{selected.product_name}</b><span>{selected.brand_name || selected.category_name}</span></div><strong>{formatRupiah(selected.selling_price)}</strong></div><form className="form-stack" onSubmit={checkout}><InquiryInput field={selectedTargetField} value={target} onChange={setTarget} fallbackLabel={classify(selected) === 'Pulsa' ? 'Nomor HP' : classify(selected) === 'E-Wallet' ? 'Nomor akun / HP' : 'User ID / Nomor tujuan'} fallbackPlaceholder="Masukkan ID atau nomor tujuan" required/><>{showZoneField && <InquiryInput field={selectedZoneField} value={zone} onChange={setZone} fallbackLabel="Server / Zone ID" fallbackPlaceholder="Masukkan Zone ID" required={Boolean(selectedZoneField?.required) || String(selected.brand_name || '').toLowerCase().includes('mobile legends')}/>}</>{selectedFormFields.slice(2).map(field => <InquiryInput key={field.key} field={field} value={additionalData[field.key] ?? ''} onChange={value => setAdditionalData(old => ({...old, [field.key]: value}))} fallbackLabel={field.name || field.key} fallbackPlaceholder={`Masukkan ${field.name || field.key}`} required={Boolean(field.required)}/>)}{selected?.inquiry_form?.notice?.id && <small className="field-note">{selected.inquiry_form.notice.id}</small>}<div className="price-summary"><span>Harga produk</span><b>{formatRupiah(selected.selling_price)}</b><small>Harga final ditentukan dari katalog saat checkout.</small></div>{checkoutError && <div className="inline-message error-text">{checkoutError}</div>}<button className="primary-btn full" disabled={checkoutBusy || !MIDTRANS_CLIENT_KEY}>{checkoutBusy ? 'Membuat pembayaran…' : 'Lanjutkan ke pembayaran'} <span>→</span></button>{!MIDTRANS_CLIENT_KEY && <small className="field-note">Midtrans Client Key belum dikonfigurasi.</small>}</form><p className="secure-modal-note">Pembayaran diproses melalui halaman aman Midtrans.</p></Modal>}
  </div>;
}

function productInitial(p) {
  const source = `${p.brand_name || ''} ${p.product_name || ''}`.toLowerCase();
  if (source.includes('mobile legends')) return 'ML';
  if (source.includes('free fire')) return 'FF';
  if (source.includes('pubg')) return 'PUBG';
  if (source.includes('telkomsel')) return 'T';
  if (source.includes('dana')) return 'D';
  return (p.brand_name || p.product_name || 'R').slice(0, 2).toUpperCase();
}
function InquiryInput({ field, value, onChange, fallbackLabel, fallbackPlaceholder, required = false }) {
  const label = field?.name || fallbackLabel || field?.key || 'Data tujuan';
  const options = Array.isArray(field?.options) ? field.options : [];
  return <label>{label} {required && <i className="required-tag">Wajib</i>}{options.length ? <select value={value} onChange={e => onChange(e.target.value)} required={required}><option value="">Pilih {label}</option>{options.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select> : <input type={field?.type === 'number' ? 'number' : 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={field?.placeholder || fallbackPlaceholder || `Masukkan ${label}`} required={required}/>}</label>;
}
function BrandCard({ brand, onOpen }) {
  const info = { category_name: brand.category_name, brand_name: brand.brand };
  return <article className="product-card brand-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}><div className="product-card-top"><div className={`product-avatar ${classNameFor(info)}`}>{productInitial({ brand_name: brand.brand })}</div><span className="available-label"><span></span> {brand.product_count} pilihan</span></div><div className="product-info"><small>{brand.category_name || 'Produk digital'}</small><h3>{brand.brand}</h3></div><div className="product-card-bottom"><div><small>Mulai dari</small><strong>{formatRupiah(brand.min_price)}</strong></div><span className="buy-btn">Lihat <span>→</span></span></div></article>;
}
function ProductCard({ product, onBuy }) {
  const type = `${product.brand_name || product.category_name || 'Digital'} · ${product.type_name || 'Produk digital'}`;
  return <article className="product-card"><div className="product-card-top"><div className={`product-avatar ${classNameFor(product)}`}>{productInitial(product)}</div><span className="available-label"><span></span> Tersedia</span></div><div className="product-info"><small>{type}</small><h3>{product.product_name}</h3><p>{product.brand_name || product.category_name}</p></div><div className="product-card-bottom"><div><small>Mulai dari</small><strong>{formatRupiah(product.selling_price)}</strong></div><button className="buy-btn" onClick={onBuy}>Pilih <span>→</span></button></div></article>;
}
function classNameFor(p) { return classifyStatic(p).toLowerCase().replace(/[^a-z]/g, '-'); }
function classifyStatic(p) {
  const s = `${p.category_name || ''} ${p.brand_name || ''} ${p.product_name || ''}`.toLowerCase();
  if (/pulsa|telkomsel|indosat|xl|axis|by\.u|smartfren|tri/.test(s)) return 'Pulsa';
  if (/dana|ovo|gopay|shopeepay|linkaja|e-wallet|ewallet/.test(s)) return 'E-Wallet';
  if (/voucher|steam|google play|itunes|gift card|pln/.test(s)) return 'Voucher';
  if (/game|games|mobile legends|free fire|pubg|valorant|roblox|genshin|8 ball/.test(s)) return 'Game';
  return 'Digital';
}
function Modal({ children, onClose, wide = false }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={wide ? 'modal-card modal-wide' : 'modal-card'}><button className="modal-close" onClick={onClose} aria-label="Tutup">×</button>{children}</section></div>;
}
function statusLabel(value) {
  const labels = { pending: 'Menunggu pembayaran', paid: 'Dibayar', expired: 'Kedaluwarsa', failed: 'Gagal', refund_pending: 'Refund diproses', refunded: 'Dikembalikan', awaiting_payment: 'Menunggu pembayaran', submitting: 'Mengirim ke provider', processing: 'Sedang diproses', success: 'Berhasil', manual_review: 'Perlu pemeriksaan', requested: 'Menunggu admin', submitted: 'Diajukan', manual_required: 'Refund manual diperlukan' };
  return labels[value] || value || '—';
}
function statusClass(value) {
  if (['success','paid','refunded'].includes(value)) return 'status-good';
  if (['failed','expired','manual_review','manual_required'].includes(value)) return 'status-bad';
  return 'status-wait';
}
function OrdersPage({ orders, loading, onRefresh, onRefund, onTwoFactor }) {
  return <section className="page-section"><div className="page-heading"><div><span className="eyebrow">ACCOUNT CENTER</span><h1>Pesanan saya</h1><p>Pantau pembayaran dan progres top-up di sini.</p></div><button className="outline-btn" onClick={onRefresh}>↻ Perbarui</button></div>{loading ? <div className="empty-state"><div className="loader"></div><b>Memuat pesanan…</b></div> : orders.length ? <div className="orders-list">{orders.map(order => <article className="order-card" key={order.id}><div className="order-main"><div className="order-icon">R</div><div className="order-details"><div className="order-name">{order.product_name}</div><small>{order.order_code} · {new Date(order.created_at).toLocaleString('id-ID')}</small><small>Tujuan: {order.target}{order.target_zone ? ` / ${order.target_zone}` : ''}</small></div><strong className="order-price">{formatRupiah(order.selling_price)}</strong></div><div className="order-statuses"><span className={`status-pill ${statusClass(order.payment_status)}`}>Pembayaran: {statusLabel(order.payment_status)}</span><span className={`status-pill ${statusClass(order.fulfillment_status)}`}>Top-up: {statusLabel(order.fulfillment_status)}</span>{order.refund_status !== 'none' && <span className={`status-pill ${statusClass(order.refund_status)}`}>Refund: {statusLabel(order.refund_status)}</span>}</div>{order.melo_action?.type === 'two_factor' && <TwoFactorForm order={order} onSubmit={onTwoFactor}/ >}{order.serial_number && <div className="serial-box"><small>Nomor referensi / serial</small><b>{order.serial_number}</b></div>}{order.error_message && <p className="order-note">Catatan: {order.error_message}</p>}{order.fulfillment_status === 'failed' && ['paid','refund_pending'].includes(order.payment_status) && ['none','manual_required'].includes(order.refund_status) && <button className="outline-btn refund-btn" onClick={() => onRefund(order)}>Ajukan / tinjau refund</button>}</article>)}</div> : <div className="empty-state"><div className="empty-icon">▤</div><b>Belum ada pesanan</b><span>Pesanan yang kamu buat akan muncul di sini.</span></div>}</section>;
}
function TwoFactorForm({ order, onSubmit }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const action = order.melo_action || {};
  if (action.state === 'resolved') return <div className="inline-message">Verifikasi penyedia telah diselesaikan. Perbarui status pesanan untuk melihat hasil terbaru.</div>;
  if (action.state === 'submitted') return <div className="inline-message">Kode verifikasi telah diteruskan ke penyedia. Menunggu pembaruan status.</div>;
  if (action.state !== 'required' || action.can_submit !== true) return null;
  async function handleSubmit(event) {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    try { const accepted = await onSubmit(order, code.trim()); if (accepted) setCode(''); }
    finally { setBusy(false); }
  }
  return <form className="two-factor-panel form-stack" onSubmit={handleSubmit}><b>Verifikasi tambahan diperlukan</b><p>{action.message || 'Penyedia meminta kode verifikasi untuk melanjutkan transaksi.'}</p><label>Kode verifikasi<input value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" maxLength={128} placeholder="Masukkan kode dari penyedia" required/></label><button className="primary-btn" disabled={busy || !code.trim()}>{busy ? 'Mengirim kode…' : 'Kirim kode verifikasi'}</button><small className="field-note">Kode hanya diteruskan ke Melo untuk transaksi ini. Jangan bagikan kode kepada pihak lain.</small></form>;
}
function AdminPage({ orders, refunds, busy, message, onSync, onRefund, onReconcile, onMarkRefunded, onRefresh }) {
  const paid = orders.filter(o => o.payment_status === 'paid').length;
  const success = orders.filter(o => o.fulfillment_status === 'success').length;
  const failed = orders.filter(o => o.fulfillment_status === 'failed').length;
  return <section className="page-section"><div className="page-heading"><div><span className="eyebrow">STORE MANAGEMENT</span><h1>Dashboard admin</h1><p>Kelola katalog, status pesanan, dan refund.</p></div><div className="admin-actions"><button className="outline-btn" onClick={onRefresh} disabled={busy}>↻ Refresh</button><button className="primary-btn" onClick={onSync} disabled={busy}>{busy ? 'Memproses…' : 'Sinkronkan katalog Melo'}</button></div></div>{message && <div className="inline-message">{message}</div>}<div className="metric-grid"><Metric title="Total pesanan" value={orders.length}/><Metric title="Pembayaran diterima" value={paid}/><Metric title="Top-up berhasil" value={success}/><Metric title="Top-up gagal" value={failed}/></div><div className="admin-panel"><div className="panel-heading"><div><h2>Transaksi terbaru</h2><p>Pemeriksaan status dan tindakan operasional.</p></div></div>{busy ? <div className="table-empty">Memuat data…</div> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Produk / tujuan</th><th>Harga</th><th>Pembayaran</th><th>Top-up</th><th>Tindakan</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td><b>{o.order_code}</b><small>{new Date(o.created_at).toLocaleString('id-ID')}</small></td><td>{o.product_name}<small>{o.target}{o.target_zone ? ` / ${o.target_zone}` : ''}</small></td><td>{formatRupiah(o.selling_price)}</td><td><span className={`status-pill ${statusClass(o.payment_status)}`}>{statusLabel(o.payment_status)}</span></td><td><span className={`status-pill ${statusClass(o.fulfillment_status)}`}>{statusLabel(o.fulfillment_status)}</span></td><td><div className="table-actions"><button onClick={() => onReconcile(o)} disabled={busy}>Cek Melo</button>{o.payment_status === 'paid' && o.fulfillment_status === 'failed' && o.refund_status !== 'refunded' && <button onClick={() => onRefund(o)} disabled={busy}>Refund API</button>}{o.fulfillment_status === 'failed' && ['manual_required','refund_pending','requested'].includes(o.refund_status) && <button onClick={() => onMarkRefunded(o)} disabled={busy}>Tandai selesai</button>}</div></td></tr>)}</tbody></table>{!orders.length && <div className="table-empty">Belum ada pesanan.</div>}</div>}</div><div className="admin-panel"><div className="panel-heading"><div><h2>Permintaan refund</h2><p>Permintaan pelanggan yang menunggu peninjauan admin.</p></div></div>{refunds.length ? <div className="refund-list">{refunds.map(r => <div className="refund-row" key={r.id}><div><b>{r.reason}</b><small>Order ID: {r.order_id} · {new Date(r.created_at).toLocaleString('id-ID')}</small></div><span className={`status-pill ${statusClass(r.status)}`}>{statusLabel(r.status)}</span></div>)}</div> : <div className="table-empty">Belum ada permintaan refund.</div>}</div><p className="admin-warning">Refund melalui API hanya dapat diproses untuk metode pembayaran yang didukung Midtrans dan transaksi yang memenuhi syarat. Untuk kasus lainnya, selesaikan pengembalian dana melalui dashboard Midtrans atau transfer manual, lalu simpan bukti transaksi.</p></section>;
}
function Metric({ title, value }) { return <div className="metric-card"><span>{title}</span><strong>{value}</strong></div>; }

if (!isSupabaseConfigured) {
  createRoot(document.getElementById('root')).render(<div className="config-error"><div className="brand-mark">R</div><h1>RyuuTopUp belum dikonfigurasi</h1><p>Tambahkan `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL`, dan `VITE_MIDTRANS_CLIENT_KEY` di Netlify, lalu deploy ulang.</p></div>);
} else {
  createRoot(document.getElementById('root')).render(<App/>);
}
