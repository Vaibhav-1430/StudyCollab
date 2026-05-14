import { API_BASE } from './config.js';
import { setToken, setUser } from './auth.js';
import { qs, showToast } from './utils.js';
import { initUI } from './ui.js';

const form = qs('#registerForm');
const errorLabel = qs('#registerError');
const passwordInput = qs('#registerPassword');
const demoBtn = qs('#demoRegisterBtn');

initUI();

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const payload = {
    name: data.get('name'),
    email: data.get('email'),
    password: data.get('password')
  };

  try {
    const response = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message || 'Registration failed');
    }

    setToken(body.token, true);
    setUser(body.user);
    window.location.href = '/dashboard';
  } catch (err) {
    if (errorLabel) {
      errorLabel.textContent = err.message;
    }
    passwordInput?.classList.add('input-error');
    showToast(err.message, 'error');
  }
});

demoBtn?.addEventListener('click', async () => {
  if (demoBtn) demoBtn.disabled = true;
  try {
    const response = await fetch(`${API_BASE}/api/auth/demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.message || 'Demo login failed');
    }
    setToken(body.token, true);
    setUser(body.user);
    window.location.href = '/dashboard';
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (demoBtn) demoBtn.disabled = false;
  }
});

form?.addEventListener('input', () => {
  if (errorLabel) errorLabel.textContent = '';
  passwordInput?.classList.remove('input-error');
});
