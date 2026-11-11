/**
 * Plan Intermedio · E-commerce Motos y Partes de Occidente
 * Interacciones de la página de detalle del plan
 */

// ===== SCROLL REVEAL =====
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add('visible'); }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.flip-card, .t-item').forEach(el => observer.observe(el));

// ===== TILT en visor 3D al mover mouse =====
const visor = document.querySelector('.visor-3d');
const scene = document.querySelector('.visor-scene');
if(visor && scene){
  visor.addEventListener('mousemove', (e) => {
    const rect = visor.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    scene.style.animation = 'none';
    scene.style.transform = `rotateX(${-15 + y * -30}deg) rotateY(${x * 60}deg)`;
  });
  visor.addEventListener('mouseleave', () => {
    scene.style.animation = 'rotateCube 20s linear infinite';
    scene.style.transform = '';
  });
}
