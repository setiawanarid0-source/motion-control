(() => {
  const $ = id => document.getElementById(id);
  const call = async (endpoint, body) => {
    const res = await fetch('/api/auth/' + endpoint, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Vanta-Auth': '1' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan. Coba lagi.');
    return data;
  };
  const login = $('ownerLoginForm');
  if (login) {
    const setMessage = msg => { $('authMessage').textContent = msg || ''; };
    const next = new URLSearchParams(location.search).get('next');
    const destination = next && next.startsWith('/') && !next.startsWith('//') &&
      !next.startsWith('/login') && !next.includes('\\') ? next : '/';
    const enter = () => location.replace(destination);
    const showChange = () => {
      $('loginArea').hidden = true; $('changeArea').hidden = false;
      $('oldPassword').focus();
    };
    call('session').then(data => {
      if (data.authenticated && data.requiresPasswordChange) showChange();
      else if (data.authenticated) enter();
    }).catch(error => setMessage(error.message));
    login.addEventListener('submit', async ev => {
      ev.preventDefault(); setMessage('');
      const button = login.querySelector('button');
      button.disabled = true;
      try {
        const data = await call('login', { password: $('ownerPassword').value });
        if (data.requiresPasswordChange) {
          $('oldPassword').value = $('ownerPassword').value;
          $('ownerPassword').value = '';
          showChange();
        } else enter();
      } catch (e) { setMessage(e.message); }
      finally { button.disabled = false; }
    });
    $('ownerChangeForm').addEventListener('submit', async ev => {
      ev.preventDefault(); setMessage('');
      const button = ev.currentTarget.querySelector('button'); button.disabled = true;
      try {
        if ($('newPassword').value !== $('confirmPassword').value) throw Error('Konfirmasi password tidak cocok.');
        await call('change-password', { oldPassword: $('oldPassword').value,
          newPassword: $('newPassword').value });
        $('oldPassword').value = $('newPassword').value = $('confirmPassword').value = '';
        enter();
      } catch (e) { setMessage(e.message); }
      finally { button.disabled = false; }
    });
  }
  for (const button of document.querySelectorAll('[data-vanta-logout]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await call('logout', {}); location.replace('/login.html'); }
      catch { button.disabled = false; }
    });
  }
})();
