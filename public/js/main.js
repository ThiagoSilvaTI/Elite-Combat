document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Header Scroll
    const header = document.querySelector('header');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });

    // 2. Reveal on Scroll com Stagger
    const revealElements = document.querySelectorAll('.reveal');
    
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, {
        threshold: 0.12,
        rootMargin: "0px 0px -80px 0px"
    });

    revealElements.forEach(el => revealObserver.observe(el));

    // 3. Efeito Parallax no Tubarão (sutil ao mover o mouse)
    const shark = document.querySelector('.shark-attack');
    if (shark) {
        document.addEventListener('mousemove', (e) => {
            const x = (e.clientX / window.innerWidth - 0.5) * 20;
            const y = (e.clientY / window.innerHeight - 0.5) * 20;
            shark.style.transform = `translate(${x}px, ${y}px)`;
        });
    }

    // 4. Smooth Scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
});
// ===== MENU MOBILE =====
const menuToggle = document.querySelector('.menu-toggle');
const navUl = document.querySelector('nav ul');

if (menuToggle && navUl) {
    menuToggle.addEventListener('click', () => {
        menuToggle.classList.toggle('active');
        navUl.classList.toggle('open');
        document.body.classList.toggle('menu-open');
    });

    navUl.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            menuToggle.classList.remove('active');
            navUl.classList.remove('open');
            document.body.classList.remove('menu-open');
        });
    });
}