/**
 * Plan Élite · E-commerce Motos y Partes de Occidente
 * Interacciones de la página de detalle del plan
 */

// ===== PARTICLES =====
const canvas = document.getElementById('particles');
const ctx = canvas.getContext('2d');
let particles = [];
let w, h;

function resize(){
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

class Particle{
  constructor(){
    this.reset();
    this.y = Math.random() * h;
  }
  reset(){
    this.x = Math.random() * w;
    this.y = -10;
    this.size = Math.random() * 2 + .5;
    this.speed = Math.random() * .5 + .2;
    this.opacity = Math.random() * .5 + .2;
    this.color = Math.random() > .5 ? '251,191,36' : '139,92,246';
  }
  update(){
    this.y += this.speed;
    if(this.y > h){ this.reset(); }
  }
  draw(){
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI*2);
    ctx.fillStyle = `rgba(${this.color},${this.opacity})`;
    ctx.fill();
  }
}

for(let i = 0; i < 60; i++) particles.push(new Particle());

function animate(){
  ctx.clearRect(0, 0, w, h);
  particles.forEach(p => { p.update(); p.draw(); });
  requestAnimationFrame(animate);
}
animate();

// ===== SCROLL REVEAL =====
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add('visible'); }
  });
}, { threshold: 0.15 });

document.querySelectorAll('.week, .process-card').forEach(el => observer.observe(el));
