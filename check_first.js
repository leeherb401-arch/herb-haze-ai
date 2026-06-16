(function() {
  const canvas  = document.getElementById('petals-canvas');
  const ctx     = canvas.getContext('2d');
  let W, H, petals = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = [
    'rgba(228,112,154,',
    'rgba(196,75,110,',
    'rgba(238,160,190,',
    'rgba(212,96,122,',
    'rgba(248,180,210,',
    'rgba(180,58,94,',
  ];

  function Petal() {
    this.reset = function(initial) {
      this.x    = Math.random() * W;
      this.y    = initial ? Math.random() * H : -20;
      this.r    = 3 + Math.random() * 6;
      this.rx   = this.r * (0.4 + Math.random() * 0.6);
      this.ry   = this.r * (0.2 + Math.random() * 0.35);
      this.rot  = Math.random() * Math.PI * 2;
      this.rotV = (Math.random() - 0.5) * 0.04;
      this.vx   = (Math.random() - 0.3) * 1.8;
      this.vy   = 0.6 + Math.random() * 1.4;
      this.sway = Math.random() * Math.PI * 2;
      this.swayS= 0.01 + Math.random() * 0.02;
      this.swayA= 0.4 + Math.random() * 0.8;
      this.color= COLORS[Math.floor(Math.random()*COLORS.length)];
      this.alpha= 0.4 + Math.random() * 0.55;
    };
    this.reset(true);

    this.update = function() {
      this.sway += this.swayS;
      this.x    += this.vx + Math.sin(this.sway) * this.swayA;
      this.y    += this.vy;
      this.rot  += this.rotV;
      if (this.y > H + 20 || this.x < -30 || this.x > W + 30) this.reset(false);
    };

    this.draw = function() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.beginPath();

      // Petal shape — two bezier curves
      ctx.moveTo(0, -this.ry);
      ctx.bezierCurveTo( this.rx,  -this.ry,  this.rx,   this.ry,  0,  this.ry);
      ctx.bezierCurveTo(-this.rx,   this.ry, -this.rx,  -this.ry,  0, -this.ry);

      ctx.fillStyle = this.color + this.alpha + ')';
      ctx.fill();

      // Petal vein
      ctx.beginPath();
      ctx.moveTo(0, -this.ry * 0.8);
      ctx.lineTo(0,  this.ry * 0.8);
      ctx.strokeStyle = this.color + (this.alpha * 0.3) + ')';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.restore();
    };
  }

  // Spawn petals
  const COUNT = 65;
  for (let i = 0; i < COUNT; i++) {
    const p = new Petal();
    petals.push(p);
  }

  // Occasional burst of petals
  function burst() {
    for (let i = 0; i < 8; i++) {
      const p = new Petal();
      p.x = Math.random() * W;
      p.y = -10;
      petals.push(p);
    }
    // Keep total reasonable
    if (petals.length > 120) petals.splice(0, 8);
    setTimeout(burst, 3000 + Math.random() * 5000);
  }
  setTimeout(burst, 4000);

  function animate() {
    ctx.clearRect(0, 0, W, H);
    petals.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }
  animate();
})();
