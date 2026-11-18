/**
 * Plan Agéntico · E-commerce Motos y Partes de Occidente
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
    this.color = Math.random() > .45 ? '139,92,246' : '34,211,238';
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

document.querySelectorAll('.week, .process-card, .cap-card, .flow-step').forEach(el => observer.observe(el));

// ===== DEMO DE CONVERSACIÓN =====
const chat = document.getElementById('agentChat');
if (chat && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const bubbles = Array.prototype.slice.call(chat.querySelectorAll('.bubble'));
  bubbles.forEach(function (b) { b.classList.remove('is-on'); });
  let i = 0;
  function next() {
    if (i < bubbles.length) {
      bubbles[i].classList.add('is-on');
      i++;
      window.setTimeout(next, 900);
      return;
    }
    window.setTimeout(function () {
      bubbles.forEach(function (b) { b.classList.remove('is-on'); });
      i = 0;
      window.setTimeout(next, 700);
    }, 4200);
  }
  window.setTimeout(next, 900);
} else if (chat) {
  chat.querySelectorAll('.bubble').forEach(function (b) { b.classList.add('is-on'); });
}
