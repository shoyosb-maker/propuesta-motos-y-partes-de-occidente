/**
 * Plan Esencial · E-commerce Motos y Partes de Occidente
 * Interacciones de la página de detalle del plan
 */

// ===== SCROLL REVEAL =====
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add('visible'); }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.acc-item, .step').forEach(el => observer.observe(el));

// ===== ACORDEÓN =====
document.querySelectorAll('.acc-item').forEach(item => {
  const head = item.querySelector('.acc-head');
  head.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.acc-item').forEach(i => i.classList.remove('open'));
    if(!isOpen) item.classList.add('open');
  });
});

// Abrir primero por defecto
document.querySelector('.acc-item').classList.add('open');
