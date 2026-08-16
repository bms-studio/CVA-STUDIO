/* CVA STUDIO — app: boot + animation engine */
'use strict';

/* ========== ANIMATION ENGINE ========== */

/* ---- Scroll Progress Bar ---- */
function initScrollProgress() {
  const bar = $('#scrollProgress');
  if (!bar) return;
  const update = () => {
    const scroll = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = max > 0 ? (scroll / max) * 100 + '%' : '0%';
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

/* ---- Particles ---- */
function initParticles() {
  const container = $('#particles');
  if (!container) return;
  const colors = ['rgba(255,255,255,0.2)', 'rgba(200,200,200,0.15)', 'rgba(255,255,255,0.1)'];
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 5;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + '%';
    p.style.setProperty('--p-drift', (Math.random() - 0.5) * 80 + 'px');
    p.style.setProperty('--p-opacity', (0.15 + Math.random() * 0.25).toFixed(2));
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = (12 + Math.random() * 18) + 's';
    p.style.animationDelay = (Math.random() * 20) + 's';
    container.appendChild(p);
  }
}

/* ---- Starfield ---- */
function initStarfield() {
  const container = $('#starfield');
  if (!container) return;
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    const s = 1 + Math.random() * 2;
    star.style.width = s + 'px';
    star.style.height = s + 'px';
    star.style.animationDelay = (Math.random() * 5) + 's';
    star.style.animationDuration = (2 + Math.random() * 4) + 's';
    container.appendChild(star);
  }
}

/* ---- Cursor Glow ---- */
function initCursorGlow() {
  const glow = $('#cursorGlow');
  if (!glow) return;
  let visible = false;
  document.addEventListener('mousemove', (e) => {
    if (!visible) { glow.style.opacity = '1'; visible = true; }
    glow.style.left = e.clientX + 'px';
    glow.style.top = e.clientY + 'px';
  }, { passive: true });
  document.addEventListener('mouseleave', () => { glow.style.opacity = '0'; visible = false; }, { passive: true });
}

/* ---- Button Ripple Effect ---- */
function initRipples() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-primary, .btn-outline, .chip');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  });
}

/* ---- Card Spotlight (mouse tracking) ---- */
function initSpotlight() {
  document.querySelectorAll('.spotlight-card, .layout-card, .feature-card, .step-card, .stat-card, .history-card').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width * 100) + '%');
      card.style.setProperty('--my', ((e.clientY - rect.top) / rect.height * 100) + '%');
    });
  });
}

/* ---- Hero Title Letter Animation ---- */
function initHeroLetters() {
  const title = document.querySelector('.hero-title');
  if (!title) return;
  // Walk through text nodes only, wrap each character in a span
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement && node.parentElement.closest('.accent-gradient')) continue; // skip accent span text
    textNodes.push(node);
  }
  let charIndex = 0;
  const delayBase = 0.15;
  textNodes.forEach((node) => {
    const text = node.textContent;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ') { frag.appendChild(document.createTextNode(' ')); continue; }
      const span = document.createElement('span');
      span.className = 'char';
      span.style.animationDelay = (delayBase + charIndex * 0.025) + 's';
      span.textContent = ch;
      frag.appendChild(span);
      charIndex++;
    }
    node.parentNode.replaceChild(frag, node);
  });
  // Also animate accent-gradient inner text
  const accent = title.querySelector('.accent-gradient');
  if (accent && !accent.querySelector('.char')) {
    const accentText = accent.textContent;
    accent.innerHTML = '';
    for (let i = 0; i < accentText.length; i++) {
      const ch = accentText[i];
      if (ch === ' ') { accent.appendChild(document.createTextNode(' ')); continue; }
      const span = document.createElement('span');
      span.className = 'char';
      span.style.animationDelay = (delayBase + charIndex * 0.025) + 's';
      span.textContent = ch;
      accent.appendChild(span);
      charIndex++;
    }
  }
}

/* ---- Smooth Number Counter Animation ---- */
function initCounters() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const raw = parseFloat(el.dataset.count) || 0;
        const decimals = Math.min(2, (String(el.dataset.count).split('.')[1] || '').length);
        const suffix = el.dataset.suffix || '';
        const duration = parseInt(el.dataset.duration) || 1600;
        const start = performance.now();
        const fmt = (n) => (decimals ? n.toFixed(decimals) : String(Math.round(n)));
        const step = (now) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = fmt(eased * raw) + suffix;
          if (progress < 1) requestAnimationFrame(step);
          else {
            el.textContent = fmt(raw) + suffix;
            el.classList.add('count-pop');
          }
        };
        requestAnimationFrame(step);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach((el) => observer.observe(el));
}

/* ---- Navbar scrolled state + scroll-to-top button ---- */
function initScrollChrome() {
  const navbar = $('#navbar');
  const topBtn = $('#scrollTopBtn');
  const onScroll = () => {
    const y = window.scrollY;
    if (navbar) navbar.classList.toggle('scrolled', y > 24);
    if (topBtn) topBtn.classList.toggle('show', y > 480);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();
  if (topBtn) {
    topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }
}

/* ---- Section Reveal Observer (improved) ---- */
function initRevealImproved() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
        entry.target.classList.add('reveal-active');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal:not(.active)').forEach((el) => observer.observe(el));
}

/* ---- Dashboard card entrance animation ---- */
function initDashboardEntrance() {
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.dashboard-body .layout-card:not(.entrance-anim)').forEach((card, i) => {
      card.classList.add('entrance-anim');
      card.style.animationDelay = (i * 0.04) + 's';
    });
  });
  const body = $('#dashboardBody');
  if (body) observer.observe(body, { childList: true });
}

/* ---- Animated equalizer for player (when playing) ---- */
function initEqualizer() {
  const chip = $('#fxLiveChips');
  if (!chip) return;
  const eq = document.createElement('span');
  eq.className = 'eq-bars';
  eq.style.display = 'none';
  for (let i = 0; i < 5; i++) eq.appendChild(document.createElement('span'));
  chip.parentNode.insertBefore(eq, chip.nextSibling);
  const origText = () => chip.textContent;
  const check = setInterval(() => {
    if (St && St.playing && eq.style.display === 'none') eq.style.display = 'inline-flex';
    else if (St && !St.playing && eq.style.display !== 'none') eq.style.display = 'none';
  }, 500);
}

/* ========== BOOT ========== */
document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  bindStatic();
  renderMarquee();

  /* Init animations */
  initScrollProgress();
  initParticles();
  initStarfield();
  initCursorGlow();
  initRipples();
  initSpotlight();
  initHeroLetters();
  initCounters();
  initRevealImproved();
  initDashboardEntrance();
  initScrollChrome();

  /* Override revealObserver with improved version */
  revealObserver = initRevealImproved;

  const enOn = State.lang === 'en';
  const set = (sel, active) => { const el = $(sel); if (el) el.classList.toggle('active', active); };
  ['#btnLangEn', '#dbLangEn'].forEach((s) => set(s, enOn));
  ['#btnLangId', '#dbLangId'].forEach((s) => set(s, !enOn));

  try {
    await ensureSession();
  } catch (e) {
    console.error('Failed to ensure session:', e);
  } finally {
    const preloader = $('#preloader');
    if (preloader) {
      preloader.classList.add('hidden');
      setTimeout(() => { if (preloader.parentNode) preloader.remove(); }, 500);
    }
  }

  /* Init equalizer after studio renders */
  setTimeout(initEqualizer, 2000);
});
