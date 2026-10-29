(function () {
    'use strict';

    // ==================== MENU MOBILE ====================
    const menuBtn = document.getElementById('menuBtn');
    const navDrawer = document.getElementById('navDrawer');
    const overlay = document.getElementById('overlay');

    function closeMenu() {
        if (menuBtn) menuBtn.classList.remove('active');
        if (navDrawer) navDrawer.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function openMenu() {
        if (menuBtn) menuBtn.classList.add('active');
        if (navDrawer) navDrawer.classList.add('open');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    if (menuBtn) {
        menuBtn.addEventListener('click', function () {
            if (navDrawer.classList.contains('open')) {
                closeMenu();
            } else {
                openMenu();
            }
        });
    }

    if (overlay) {
        overlay.addEventListener('click', closeMenu);
    }

    // Fecha ao clicar em link
    if (navDrawer) {
        navDrawer.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', closeMenu);
        });
    }

    // ==================== BOTÃO VOLTAR AO TOPO ====================
    const backTop = document.getElementById('backTop');
    if (backTop) {
        window.addEventListener('scroll', function () {
            if (window.scrollY > 400) {
                backTop.classList.add('show');
            } else {
                backTop.classList.remove('show');
            }
        }, { passive: true });

        backTop.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ==================== REVEAL SIMPLES (CSS transition) ====================
    if ('IntersectionObserver' in window) {
        const reveals = document.querySelectorAll('.reveal');
        if (reveals.length) {
            const obs = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('active');
                        obs.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1 });

            reveals.forEach(function (el) { obs.observe(el); });
        }
    } else {
        // Fallback: mostra tudo
        document.querySelectorAll('.reveal').forEach(function (el) {
            el.classList.add('active');
        });
    }
})();