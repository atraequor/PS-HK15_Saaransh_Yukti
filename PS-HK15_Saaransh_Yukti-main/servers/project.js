/* ── REVEAL ─────────────────────────────────── */
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('on'); });
    }, { threshold: .12 });
    document.querySelectorAll('.rv').forEach(el => obs.observe(el));

    /* ── SMOOTH SCROLL ──────────────────────────── */
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const href = a.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    /* ── TABS ───────────────────────────────────── */
    function switchTab(i) {
      document.querySelectorAll('.tab-btn').forEach((b, j) => b.classList.toggle('active', i === j));
      document.querySelectorAll('.tab-panel').forEach((p, j) => p.classList.toggle('active', i === j));
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.tab);
        if (!Number.isNaN(idx)) switchTab(idx);
      });
    });

    const navLogoImg = document.getElementById('nav-logo-img');
    const navLogoFallback = document.getElementById('nav-logo-fallback');
    if (navLogoImg && navLogoFallback) {
      const showFallback = () => {
        navLogoImg.style.display = 'none';
        navLogoFallback.style.display = 'flex';
      };
      navLogoImg.addEventListener('error', showFallback);
      if (!navLogoImg.getAttribute('src')) {
        showFallback();
      }
    }

    /* ── MAIN PAGE NAV VISIBILITY + HERO HEIGHT ───── */
    const blankTop = document.getElementById('blank-top');
    const pageBody = document.getElementById('page-body');
    const mainNav = document.getElementById('main-nav');
    const hero = document.getElementById('hero');

    if (blankTop && pageBody && mainNav && hero) {
      const syncNavHeightVar = () => {
        const h = Math.round(mainNav.getBoundingClientRect().height || 84);
        document.documentElement.style.setProperty('--main-nav-h', `${h}px`);
      };

      syncNavHeightVar();
      window.addEventListener('resize', syncNavHeightVar);

      let lastY = pageBody.scrollTop;
      pageBody.addEventListener('scroll', () => {
        const y = pageBody.scrollTop;
        const delta = y - lastY;

        if (y <= 8) {
          mainNav.classList.remove('nav-hidden');
        } else if (delta > 6) {
          mainNav.classList.add('nav-hidden');
        } else if (delta < -6) {
          mainNav.classList.remove('nav-hidden');
        }

        lastY = y;
      }, { passive: true });
    }
