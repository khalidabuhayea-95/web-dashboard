/* ══════════════════════════════════════════
   نيروز — shared site behaviour
   Nav shadow, mobile menu, scroll reveal, FAQ accordion + filtering,
   table-of-contents highlighting, contact form handling.
   Every block is defensive: pages only opt into what they render.
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── nav shadow on scroll ────────────────────────────── */
  var nav = document.getElementById('nav');
  if (nav) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        nav.classList.toggle('scrolled', window.scrollY > 20);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── mobile menu ─────────────────────────────────────── */
  var menu = document.getElementById('mobileMenu');
  var hamburger = document.getElementById('hamburger');
  var closeBtn = document.querySelector('.mobile-menu-close');

  function openMenu() {
    if (!menu) return;
    menu.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    if (!menu) return;
    menu.classList.remove('open');
    document.body.style.overflow = '';
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
  }

  if (hamburger) hamburger.addEventListener('click', openMenu);
  if (closeBtn) closeBtn.addEventListener('click', closeMenu);
  if (menu) {
    menu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeMenu();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  /* ── scroll reveal ───────────────────────────────────── */
  var revealables = document.querySelectorAll('.reveal');
  function revealAll() {
    revealables.forEach(function (el) { el.classList.add('visible'); });
  }
  if (revealables.length) {
    if ('IntersectionObserver' in window) {
      // threshold must stay 0: a ratio-based threshold can never be met by a block
      // taller than the viewport / threshold (a long legal page never reaches 12%),
      // which would leave the whole article stuck at opacity 0.
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0, rootMargin: '0px 0px -40px 0px' });
      revealables.forEach(function (el) { observer.observe(el); });
      // Content must never stay invisible because an animation failed to fire.
      setTimeout(revealAll, 3000);
    } else {
      revealAll();
    }
  }

  /* ── FAQ accordion ───────────────────────────────────── */
  document.querySelectorAll('.faq-q').forEach(function (btn) {
    var item = btn.closest('.faq-item');
    var answer = item ? item.querySelector('.faq-a') : null;
    btn.setAttribute('aria-expanded', 'false');
    if (answer && !answer.id) {
      answer.id = 'faq-a-' + Math.abs(hashCode(btn.textContent)).toString(36);
    }
    if (answer) btn.setAttribute('aria-controls', answer.id);

    btn.addEventListener('click', function () {
      var isOpen = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });

  function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  /* ── FAQ search + category filter ────────────────────── */
  var faqSearch = document.getElementById('faqSearch');
  var faqCats = document.querySelectorAll('.faq-cat');
  var faqItems = document.querySelectorAll('.faq-item');
  var faqGroups = document.querySelectorAll('.faq-group');
  var faqEmpty = document.getElementById('faqEmpty');
  var activeCat = 'all';

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      // strip Arabic diacritics so "الأسعار" matches "الاسعار"
      .replace(/[ً-ْٰـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .trim();
  }

  function applyFaqFilter() {
    if (!faqItems.length) return;
    var q = normalize(faqSearch ? faqSearch.value : '');
    var visible = 0;

    faqItems.forEach(function (item) {
      var cat = item.getAttribute('data-cat') || '';
      var matchesCat = activeCat === 'all' || cat === activeCat;
      var matchesText = !q || normalize(item.textContent).indexOf(q) !== -1;
      var show = matchesCat && matchesText;
      item.hidden = !show;
      if (show) visible++;
    });

    // hide group headings that have no visible questions left
    faqGroups.forEach(function (group) {
      var anyVisible = group.querySelector('.faq-item:not([hidden])');
      group.hidden = !anyVisible;
    });

    if (faqEmpty) faqEmpty.classList.toggle('show', visible === 0);
  }

  if (faqSearch) faqSearch.addEventListener('input', applyFaqFilter);
  faqCats.forEach(function (btn) {
    btn.addEventListener('click', function () {
      faqCats.forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      activeCat = btn.getAttribute('data-cat') || 'all';
      applyFaqFilter();
    });
  });

  /* ── document table of contents highlighting ─────────── */
  var tocLinks = document.querySelectorAll('.doc-toc a');
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var headings = [];
    tocLinks.forEach(function (link) {
      var id = link.getAttribute('href');
      if (id && id.charAt(0) === '#') {
        var el = document.querySelector(id);
        if (el) headings.push({ el: el, link: link });
      }
    });

    var tocObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        tocLinks.forEach(function (l) { l.classList.remove('active'); });
        var match = headings.filter(function (h) { return h.el === entry.target; })[0];
        if (match) match.link.classList.add('active');
      });
    }, { rootMargin: '-90px 0px -70% 0px' });

    headings.forEach(function (h) { tocObserver.observe(h.el); });
  }

  /* ── current year in footer ──────────────────────────── */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear().toLocaleString('ar-EG', { useGrouping: false });
  });

  /* ── contact form ────────────────────────────────────── */
  var contactForm = document.getElementById('contactForm');
  if (contactForm) {
    var status = document.getElementById('formStatus');
    var submitBtn = contactForm.querySelector('button[type="submit"]');

    var to = contactForm.getAttribute('data-mailto') || 'support@nayroz.com';

    function setStatus(text, ok) {
      if (!status) return;
      status.textContent = text;
      status.className = 'form-status ' + (ok ? 'ok' : 'err') + ' show';
    }

    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!contactForm.reportValidity()) return;
      if (submitBtn && submitBtn.disabled) return;

      var data = new FormData(contactForm);
      var payload = {
        name: data.get('name') || '',
        email: data.get('email') || '',
        topic: data.get('topic') || 'general',
        device: data.get('device') || '',
        message: data.get('message') || '',
        website: data.get('website') || ''
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-busy');
      }
      setStatus('جاري إرسال رسالتك…', true);

      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.json().then(
            function (body) { return { ok: response.ok, body: body }; },
            function () { return { ok: response.ok, body: {} }; }
          );
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(result.body && result.body.error);
          }
          contactForm.reset();
          setStatus('وصلتنا رسالتك. سنردّ على بريدك خلال يومَي عمل.', true);
        })
        .catch(function (error) {
          setStatus(
            (error && error.message ? error.message + ' ' : '') +
              'تعذّر إرسال الرسالة. حاول مرة أخرى أو راسلنا مباشرة على ' + to,
            false
          );
        })
        .then(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-busy');
          }
        });
    });
  }
})();
